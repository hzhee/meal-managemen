import "dotenv/config";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import Razorpay from "razorpay";
import { z } from "zod";
import { createToken, requireAuth } from "./auth.js";
import { pool } from "./db.js";
import { dispatchPendingWhatsApp, queueWhatsAppEvent } from "./notifications.js";
import { creditVerifiedRazorpayPayment } from "./payments.js";

const app = express();
const port = Number(process.env.PORT || 8787);
const origin = process.env.CORS_ORIGIN?.split(",") ?? ["http://127.0.0.1:5173"];
const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET }) : null;

function signaturesMatch(received, expected) {
  const left = Buffer.from(received || "");
  const right = Buffer.from(expected || "");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin, methods: ["GET", "POST", "PATCH"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 250, standardHeaders: "draft-8", legacyHeaders: false }));

// Razorpay signature verification must use the original request bytes.
app.post("/api/payments/razorpay/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.get("x-razorpay-signature") || "";
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET || "").update(req.body).digest("hex");
  if (!process.env.RAZORPAY_WEBHOOK_SECRET || !signaturesMatch(signature, expected)) return res.status(400).json({ error: "Invalid webhook signature." });
  const event = JSON.parse(req.body.toString("utf8"));
  await pool.query("insert into webhook_events (provider, event_id, payload) values ('razorpay', $1, $2) on conflict (provider, event_id) do nothing", [event.payload?.payment?.entity?.id || event.event, event]);
  if (event.event === "payment.captured") {
    const payment = event.payload?.payment?.entity;
    if (payment?.order_id && payment?.id) {
      const credit = await creditVerifiedRazorpayPayment({ orderId: payment.order_id, paymentId: payment.id });
      if (!credit.alreadyProcessed) await safelyQueueWalletRecharge(credit, payment.id);
    }
  }
  res.status(200).json({ ok: true });
});

app.get("/api/whatsapp/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN) return res.status(200).send(req.query["hub.challenge"]);
  return res.sendStatus(403);
});

app.post("/api/whatsapp/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.get("x-hub-signature-256") || "";
  const expected = `sha256=${crypto.createHmac("sha256", process.env.WHATSAPP_APP_SECRET || "").update(req.body).digest("hex")}`;
  if (!process.env.WHATSAPP_APP_SECRET || !signaturesMatch(signature, expected)) return res.sendStatus(401);
  const event = JSON.parse(req.body.toString("utf8"));
  const statuses = event.entry?.flatMap((entry) => entry.changes ?? []).flatMap((change) => change.value?.statuses ?? []) ?? [];
  for (const status of statuses) await pool.query("update notifications set status=$2, provider_response=$3 where provider_reference=$1", [status.id, status.status.toUpperCase(), status]);
  res.sendStatus(200);
});

app.use(express.json({ limit: "100kb" }));

async function safelyQueueWalletRecharge(credit, paymentId) {
  try {
    const profile = await pool.query("select s.full_name from students s where s.user_id=$1", [credit.studentId]);
    await queueWhatsAppEvent({ studentId: credit.studentId, event: "WALLET_RECHARGE_SUCCESS", payload: { student_name: profile.rows[0]?.full_name ?? "Student", amount: credit.amount, wallet_balance: credit.balance }, idempotencyKey: `wallet-recharge:${paymentId}` });
  } catch (error) {
    // Messaging must never undo a verified wallet credit.
    console.warn("Could not queue wallet notification", error instanceof Error ? error.message : error);
  }
}

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(128) });
const profileSchema = z.object({ fullName: z.string().trim().min(2).max(100), phone: z.string().trim().min(8).max(20), college: z.string().trim().min(2).max(100), hostel: z.string().trim().min(1).max(100), roomNumber: z.string().trim().min(1).max(30), lunchLocation: z.string().trim().min(2).max(150), dinnerLocation: z.string().trim().min(2).max(150), lunchTiming: z.string().trim().min(2).max(40), dinnerTiming: z.string().trim().min(2).max(40), lunchPreference: z.enum(["Veg", "Non-Veg"]), dinnerPreference: z.enum(["Veg", "Non-Veg"]) });

app.get("/api/health", async (_req, res) => {
  await pool.query("select 1");
  res.json({ ok: true, payments: razorpay ? "configured" : "not_configured", whatsapp: process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN ? "configured" : "not_configured" });
});

app.post("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-8", legacyHeaders: false }), async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const { rows } = await pool.query("select id, email, password_hash, role from users where lower(email) = lower($1)", [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: "Invalid email or password." });
    res.json({ token: createToken(user), user: { id: user.id, email: user.email, role: user.role } });
  } catch (error) { next(error); }
});

app.get("/api/me", requireAuth(), async (req, res, next) => {
  try {
    const { rows } = await pool.query("select id, email, phone, role, created_at from users where id = $1", [req.user.sub]);
    res.json({ user: rows[0] });
  } catch (error) { next(error); }
});

app.patch("/api/students/me", requireAuth(["student"]), async (req, res, next) => {
  try {
    const data = profileSchema.parse(req.body);
    const { rows } = await pool.query(`update students set full_name=$2, college=$3, hostel=$4, room_number=$5, lunch_location=$6, dinner_location=$7, lunch_timing=$8, dinner_timing=$9, lunch_preference=$10, dinner_preference=$11 where user_id=$1 returning *`, [req.user.sub, data.fullName, data.college, data.hostel, data.roomNumber, data.lunchLocation, data.dinnerLocation, data.lunchTiming, data.dinnerTiming, data.lunchPreference, data.dinnerPreference]);
    await pool.query("update users set phone=$2 where id=$1", [req.user.sub, data.phone]);
    res.json({ student: rows[0] });
  } catch (error) { next(error); }
});

app.post("/api/payments/razorpay/order", requireAuth(["student"]), async (req, res, next) => {
  try {
    const { amount } = z.object({ amount: z.number().int().min(10).max(20000) }).parse(req.body);
    if (!razorpay || !process.env.RAZORPAY_KEY_ID?.startsWith("rzp_")) return res.status(503).json({ error: "Razorpay is not configured. Add Razorpay test or live keys to the server environment." });
    const receipt = `wallet_${req.user.sub.slice(0, 8)}_${Date.now()}`;
    const order = await razorpay.orders.create({ amount: amount * 100, currency: "INR", receipt, notes: { student_id: req.user.sub, purpose: "wallet_recharge" } });
    await pool.query("insert into payments (student_id, provider_order_id, amount, status) values ($1, $2, $3, 'CREATED')", [req.user.sub, order.id, amount]);
    res.status(201).json({ keyId: process.env.RAZORPAY_KEY_ID, orderId: order.id, amount, currency: "INR" });
  } catch (error) { next(error); }
});

app.post("/api/payments/razorpay/verify", requireAuth(["student"]), async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = z.object({ razorpay_order_id: z.string().min(1), razorpay_payment_id: z.string().min(1), razorpay_signature: z.string().length(64) }).parse(req.body);
    const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "").update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
    if (!process.env.RAZORPAY_KEY_SECRET || !signaturesMatch(razorpay_signature, expected)) return res.status(400).json({ error: "Payment verification failed." });
    const paymentOwner = await pool.query("select student_id from payments where provider_order_id=$1", [razorpay_order_id]);
    if (!paymentOwner.rows[0] || paymentOwner.rows[0].student_id !== req.user.sub) return res.status(404).json({ error: "Payment order not found." });
    const result = await creditVerifiedRazorpayPayment({ orderId: razorpay_order_id, paymentId: razorpay_payment_id });
    if (!result.alreadyProcessed) await safelyQueueWalletRecharge(result, razorpay_payment_id);
    res.json({ verified: true, ...result });
  } catch (error) { next(error); }
});

app.post("/api/admin/notifications", requireAuth(["admin"]), async (req, res, next) => {
  try {
    const data = z.object({ studentId: z.string().uuid(), event: z.string().min(2).max(100), payload: z.record(z.string(), z.unknown()), idempotencyKey: z.string().min(8).max(180) }).parse(req.body);
    await queueWhatsAppEvent(data);
    res.status(201).json({ queued: true });
  } catch (error) { next(error); }
});

app.post("/api/admin/notifications/dispatch", requireAuth(["admin"]), async (_req, res, next) => {
  try { res.json({ messages: await dispatchPendingWhatsApp() }); } catch (error) { next(error); }
});

app.get("/api/admin/students", requireAuth(["admin"]), async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`select u.id, u.email, u.phone, s.full_name, s.college, s.hostel, s.room_number,
      s.lunch_location, s.dinner_location, s.lunch_timing, s.dinner_timing, s.lunch_preference, s.dinner_preference,
      coalesce(w.balance, 0) as wallet_balance,
      count(o.id) filter (where o.status in ('CONFIRMED','DELIVERED')) as confirmed_orders
      from users u join students s on s.user_id=u.id left join wallets w on w.student_id=u.id left join orders o on o.student_id=u.id
      group by u.id, s.user_id, w.balance order by s.full_name`);
    res.json({ students: rows });
  } catch (error) { next(error); }
});

app.patch("/api/drivers/deliveries/:deliveryId/status", requireAuth(["driver"]), async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(["Assigned", "Preparing", "Ready", "Out for Delivery", "Delivered"]) }).parse(req.body);
    const delivery = await pool.query(`update deliveries set status=$3, updated_at=now(), eta_minutes=case when $3='Delivered' then 0 else eta_minutes end
      where id=$1 and driver_id=$2 returning *`, [req.params.deliveryId, req.user.sub, status]);
    if (!delivery.rows[0]) return res.status(404).json({ error: "Assigned delivery not found." });
    const order = await pool.query("select student_id, meal from orders where id=$1", [delivery.rows[0].order_id]);
    if (order.rows[0]) {
      try { await queueWhatsAppEvent({ studentId: order.rows[0].student_id, event: "DELIVERY_STATUS_CHANGED", payload: { meal: order.rows[0].meal, delivery_status: status, eta: delivery.rows[0].eta_minutes ?? "" }, idempotencyKey: `delivery:${delivery.rows[0].id}:${status}` }); } catch (error) { console.warn("Could not queue delivery notification", error instanceof Error ? error.message : error); }
    }
    res.json({ delivery: delivery.rows[0] });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid request.", details: error.flatten() });
  console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : "Something went wrong. Please try again." });
});

app.listen(port, () => console.log(`Sowmy Kitchen API listening on ${port}`));
