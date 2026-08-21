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
import { pool, withTransaction } from "./db.js";

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
  // Payment is credited only by verify-and-credit below. The webhook is safely recorded for reconciliation.
  const event = JSON.parse(req.body.toString("utf8"));
  await pool.query("insert into webhook_events (provider, event_id, payload) values ('razorpay', $1, $2) on conflict (provider, event_id) do nothing", [event.payload?.payment?.entity?.id || event.event, event]);
  res.status(200).json({ ok: true });
});

app.use(express.json({ limit: "100kb" }));

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(128) });
const profileSchema = z.object({ fullName: z.string().trim().min(2).max(100), phone: z.string().trim().min(8).max(20), college: z.string().trim().min(2).max(100), hostel: z.string().trim().min(1).max(100), roomNumber: z.string().trim().min(1).max(30), lunchLocation: z.string().trim().min(2).max(150), dinnerLocation: z.string().trim().min(2).max(150), lunchTiming: z.string().trim().min(2).max(40), dinnerTiming: z.string().trim().min(2).max(40), lunchPreference: z.enum(["Veg", "Non-Veg"]), dinnerPreference: z.enum(["Veg", "Non-Veg"]) });

app.get("/api/health", async (_req, res) => {
  await pool.query("select 1");
  res.json({ ok: true, payments: razorpay ? "configured" : "not_configured" });
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
    const result = await withTransaction(async (client) => {
      const payment = await client.query("select * from payments where provider_order_id=$1 and student_id=$2 for update", [razorpay_order_id, req.user.sub]);
      if (!payment.rows[0]) throw Object.assign(new Error("Payment order not found."), { status: 404 });
      if (payment.rows[0].status === "SUCCESS") return { balance: null, alreadyProcessed: true };
      const wallet = await client.query("select balance from wallets where student_id=$1 for update", [req.user.sub]);
      if (!wallet.rows[0]) throw Object.assign(new Error("Wallet not found."), { status: 404 });
      const before = wallet.rows[0].balance;
      const after = before + payment.rows[0].amount;
      await client.query("update wallets set balance=$2 where student_id=$1", [req.user.sub, after]);
      await client.query("update payments set provider_payment_id=$2, status='SUCCESS', verified_at=now() where id=$1", [payment.rows[0].id, razorpay_payment_id]);
      await client.query("insert into wallet_transactions (student_id, amount, type, description, balance_before, balance_after, status, idempotency_key) values ($1,$2,'WALLET_RECHARGE','Verified Razorpay wallet recharge',$3,$4,'SUCCESS',$5)", [req.user.sub, payment.rows[0].amount, before, after, `razorpay:${razorpay_payment_id}`]);
      return { balance: after, alreadyProcessed: false };
    });
    res.json({ verified: true, ...result });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid request.", details: error.flatten() });
  console.error(error);
  res.status(error.status || 500).json({ error: error.status ? error.message : "Something went wrong. Please try again." });
});

app.listen(port, () => console.log(`Sowmy Kitchen API listening on ${port}`));
