import { withTransaction } from "./db.js";

// Called only after a valid checkout signature or a verified Razorpay webhook.
// The payment/order rows and wallet are locked so either path can run safely.
export async function creditVerifiedRazorpayPayment({ orderId, paymentId }) {
  return withTransaction(async (client) => {
    const paymentResult = await client.query("select * from payments where provider_order_id=$1 for update", [orderId]);
    const payment = paymentResult.rows[0];
    if (!payment) throw Object.assign(new Error("Payment order not found."), { status: 404 });
    if (payment.status === "SUCCESS") return { balance: null, amount: payment.amount, alreadyProcessed: true, studentId: payment.student_id };
    const walletResult = await client.query("select balance from wallets where student_id=$1 for update", [payment.student_id]);
    const wallet = walletResult.rows[0];
    if (!wallet) throw Object.assign(new Error("Wallet not found."), { status: 404 });
    const before = wallet.balance;
    const after = before + payment.amount;
    await client.query("update wallets set balance=$2 where student_id=$1", [payment.student_id, after]);
    await client.query("update payments set provider_payment_id=$2, status='SUCCESS', verified_at=now() where id=$1", [paymentId, payment.id]);
    await client.query("insert into wallet_transactions (student_id, amount, type, description, balance_before, balance_after, status, idempotency_key) values ($1,$2,'WALLET_RECHARGE','Verified Razorpay wallet recharge',$3,$4,'SUCCESS',$5) on conflict (idempotency_key) do nothing", [payment.student_id, payment.amount, before, after, `razorpay:${paymentId}`]);
    return { balance: after, amount: payment.amount, alreadyProcessed: false, studentId: payment.student_id };
  });
}
