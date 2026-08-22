import crypto from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onUserCreated } from "firebase-functions/v2/identity";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import Razorpay from "razorpay";

initializeApp();
const db = getFirestore();
const razorpayKeyId = defineSecret("RAZORPAY_KEY_ID");
const razorpayKeySecret = defineSecret("RAZORPAY_KEY_SECRET");
const razorpayWebhookSecret = defineSecret("RAZORPAY_WEBHOOK_SECRET");
const whatsappToken = defineSecret("WHATSAPP_ACCESS_TOKEN");
const whatsappPhoneNumberId = defineSecret("WHATSAPP_PHONE_NUMBER_ID");
const initialOwnerEmail = defineSecret("INITIAL_OWNER_EMAIL");

function hmac(secret, value) { return crypto.createHmac("sha256", secret).update(value).digest("hex"); }
function sameSignature(one, two) { const left = Buffer.from(one || ""); const right = Buffer.from(two || ""); return left.length === right.length && crypto.timingSafeEqual(left, right); }
async function userFromRequest(request) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpsError("unauthenticated", "Sign in is required.");
  return getAuth().verifyIdToken(token);
}
function requireAdmin(user) { if (user.role !== "admin") throw new HttpsError("permission-denied", "Admin access is required."); }

// Bootstrap only the one owner email supplied as a Functions secret. No password is ever stored in code.
export const bootstrapOwner = onUserCreated({ secrets: [initialOwnerEmail] }, async (event) => {
  const user = event.data;
  const ownerEmail = initialOwnerEmail.value().trim().toLowerCase();
  const role = user.email?.toLowerCase() === ownerEmail ? "admin" : "student";
  await getAuth().setCustomUserClaims(user.uid, { role });
  const profileRef = db.collection("students").doc(user.uid);
  if (role === "admin") {
    await db.collection("auditLogs").add({ actorId: user.uid, action: "OWNER_BOOTSTRAPPED", entity: "users", newValue: { email: user.email }, createdAt: FieldValue.serverTimestamp() });
    return;
  }
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(profileRef);
    if (existing.exists) return;
    transaction.set(profileRef, { fullName: user.displayName || "New student", email: user.email || "", phone: user.phoneNumber || "", role: "student", isActive: true, createdAt: FieldValue.serverTimestamp() });
    transaction.set(db.collection("wallets").doc(user.uid), { studentId: user.uid, balance: 0, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
});
async function creditWallet({ razorpayOrderId, razorpayPaymentId }) {
  const paymentRef = db.collection("payments").doc(razorpayOrderId);
  return db.runTransaction(async (transaction) => {
    const payment = await transaction.get(paymentRef);
    if (!payment.exists) throw new HttpsError("not-found", "Payment order not found.");
    const paymentData = payment.data();
    if (paymentData.status === "SUCCESS") return { alreadyProcessed: true, studentId: paymentData.studentId, balance: null };
    const walletRef = db.collection("wallets").doc(paymentData.studentId);
    const wallet = await transaction.get(walletRef);
    if (!wallet.exists) throw new HttpsError("not-found", "Wallet not found.");
    const before = wallet.data().balance || 0;
    const after = before + paymentData.amount;
    transaction.update(walletRef, { balance: after, updatedAt: FieldValue.serverTimestamp() });
    transaction.update(paymentRef, { status: "SUCCESS", razorpayPaymentId, verifiedAt: FieldValue.serverTimestamp() });
    transaction.set(db.collection("walletTransactions").doc(`razorpay_${razorpayPaymentId}`), { studentId: paymentData.studentId, amount: paymentData.amount, type: "WALLET_RECHARGE", description: "Verified Razorpay wallet recharge", balanceBefore: before, balanceAfter: after, status: "SUCCESS", referenceId: razorpayOrderId, createdAt: FieldValue.serverTimestamp() });
    return { alreadyProcessed: false, studentId: paymentData.studentId, balance: after, amount: paymentData.amount };
  });
}

export const createRazorpayOrder = onRequest({ cors: true, secrets: [razorpayKeyId, razorpayKeySecret] }, async (request, response) => {
  try {
    if (request.method !== "POST") return response.status(405).send("Method not allowed");
    const user = await userFromRequest(request);
    const amount = Number(request.body?.amount);
    if (!Number.isInteger(amount) || amount < 10 || amount > 20000) return response.status(400).json({ error: "Recharge amount must be between ₹10 and ₹20,000." });
    const razorpay = new Razorpay({ key_id: razorpayKeyId.value(), key_secret: razorpayKeySecret.value() });
    const order = await razorpay.orders.create({ amount: amount * 100, currency: "INR", receipt: `wallet_${user.uid.slice(0, 8)}_${Date.now()}`, notes: { studentId: user.uid, purpose: "wallet_recharge" } });
    await db.collection("payments").doc(order.id).set({ studentId: user.uid, provider: "razorpay", amount, status: "CREATED", createdAt: FieldValue.serverTimestamp() });
    response.status(201).json({ keyId: razorpayKeyId.value(), orderId: order.id, amount, currency: "INR" });
  } catch (error) { response.status(error instanceof HttpsError ? 401 : 500).json({ error: error.message || "Could not create payment order." }); }
});

export const verifyRazorpayPayment = onRequest({ cors: true, secrets: [razorpayKeySecret] }, async (request, response) => {
  try {
    if (request.method !== "POST") return response.status(405).send("Method not allowed");
    const user = await userFromRequest(request);
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = request.body || {};
    const expected = hmac(razorpayKeySecret.value(), `${razorpay_order_id}|${razorpay_payment_id}`);
    if (!sameSignature(razorpay_signature, expected)) return response.status(400).json({ error: "Payment verification failed." });
    const payment = await db.collection("payments").doc(razorpay_order_id).get();
    if (!payment.exists || payment.data().studentId !== user.uid) return response.status(404).json({ error: "Payment order not found." });
    response.json({ verified: true, ...(await creditWallet({ razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id })) });
  } catch (error) { response.status(error instanceof HttpsError ? 401 : 500).json({ error: error.message || "Could not verify payment." }); }
});

export const razorpayWebhook = onRequest({ secrets: [razorpayWebhookSecret] }, async (request, response) => {
  const signature = request.headers["x-razorpay-signature"];
  const expected = hmac(razorpayWebhookSecret.value(), request.rawBody);
  if (!sameSignature(signature, expected)) return response.status(400).json({ error: "Invalid Razorpay webhook signature." });
  const payment = request.body?.payload?.payment?.entity;
  if (request.body?.event === "payment.captured" && payment?.order_id && payment?.id) await creditWallet({ razorpayOrderId: payment.order_id, razorpayPaymentId: payment.id });
  response.json({ ok: true });
});

export const setUserRole = onCall(async (request) => {
  requireAdmin(request.auth?.token || {});
  const { uid, role } = request.data || {};
  if (!uid || !["admin", "driver", "student"].includes(role)) throw new HttpsError("invalid-argument", "uid and a valid role are required.");
  await getAuth().setCustomUserClaims(uid, { role });
  await db.collection("auditLogs").add({ actorId: request.auth.uid, action: "ROLE_UPDATED", entity: "users", newValue: { uid, role }, createdAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

export const sendWhatsAppNotification = onDocumentCreated({ document: "notifications/{notificationId}", secrets: [whatsappToken, whatsappPhoneNumberId] }, async (event) => {
  const notification = event.data?.data();
  if (!notification || notification.channel !== "WHATSAPP" || notification.status !== "PENDING") return;
  const [student, template] = await Promise.all([db.collection("students").doc(notification.studentId).get(), db.collection("whatsappTemplates").doc(notification.templateId).get()]);
  if (!student.exists || !template.exists) return event.data.ref.update({ status: "FAILED", failureReason: "Student or WhatsApp template missing" });
  const templateData = template.data();
  const values = (templateData.variables || []).map((key) => ({ type: "text", text: String(notification.payload?.[key] ?? "") }));
  const result = await fetch(`https://graph.facebook.com/v22.0/${whatsappPhoneNumberId.value()}/messages`, { method: "POST", headers: { Authorization: `Bearer ${whatsappToken.value()}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: student.data().phone.replace(/\D/g, ""), type: "template", template: { name: templateData.providerTemplateName, language: { code: templateData.language || "en" }, ...(values.length ? { components: [{ type: "body", parameters: values }] } : {}) } }) });
  const response = await result.json();
  await event.data.ref.update(result.ok ? { status: "SENT", providerReference: response.messages?.[0]?.id || null, sentAt: FieldValue.serverTimestamp() } : { status: "FAILED", failureReason: response.error?.message || "WhatsApp rejected request", retryCount: FieldValue.increment(1) });
});

export const notifyDeliveryStatus = onDocumentUpdated("deliveries/{deliveryId}", async (event) => {
  const before = event.data?.before.data(); const after = event.data?.after.data();
  if (!after || before.status === after.status) return;
  await db.collection("notifications").doc(`delivery_${event.params.deliveryId}_${after.status.replaceAll(" ", "_")}`).set({ studentId: after.studentId, event: "DELIVERY_STATUS_CHANGED", channel: "WHATSAPP", templateId: "delivery_status", payload: { delivery_status: after.status, eta: after.etaMinutes ?? "" }, status: "PENDING", createdAt: FieldValue.serverTimestamp() });
});
