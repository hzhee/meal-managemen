export type PaymentMode = "mock" | "razorpay";
export type WhatsAppMode = "mock" | "official-provider";

export interface VerifiedPayment {
  provider: "razorpay";
  paymentId: string;
  orderId: string;
  amount: number;
  verified: boolean;
}

interface RazorpayCheckoutOrder {
  keyId: string;
  orderId: string;
  amount: number;
  currency: "INR";
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const apiBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "");

async function apiRequest<T>(path: string, token: string, body?: unknown): Promise<T> {
  if (!apiBase) throw new Error("Payment API is not configured. Set VITE_API_BASE_URL.");
  const response = await fetch(`${apiBase}${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Payment request failed.");
  return data as T;
}

export async function startRazorpayWalletRecharge(input: { amount: number; token: string; customerName: string; customerEmail: string; customerPhone: string; onVerified: (result: { balance: number | null; alreadyProcessed: boolean }) => void; onDismiss?: () => void }) {
  const order = await apiRequest<RazorpayCheckoutOrder>("/payments/razorpay/order", input.token, { amount: input.amount });
  if (!window.Razorpay) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Could not load Razorpay Checkout."));
      document.head.appendChild(script);
    });
  }
  if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable.");
  new window.Razorpay({
    key: order.keyId, amount: order.amount * 100, currency: order.currency, name: "Sowmy Kitchen", description: "Wallet recharge", order_id: order.orderId,
    prefill: { name: input.customerName, email: input.customerEmail, contact: input.customerPhone.replace(/\D/g, "") },
    handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
      const verified = await apiRequest<{ balance: number | null; alreadyProcessed: boolean }>("/payments/razorpay/verify", input.token, response);
      input.onVerified(verified);
    },
    modal: { ondismiss: input.onDismiss }
  }).open();
}

export async function verifyRazorpayPayment(input: {
  mode: PaymentMode;
  paymentId: string;
  orderId: string;
  amount: number;
  signature?: string;
}): Promise<VerifiedPayment> {
  if (input.mode === "mock") {
    return { provider: "razorpay", paymentId: input.paymentId, orderId: input.orderId, amount: input.amount, verified: true };
  }

  if (!input.signature) {
    return { provider: "razorpay", paymentId: input.paymentId, orderId: input.orderId, amount: input.amount, verified: false };
  }

  throw new Error("Production Razorpay verification must run server-side with RAZORPAY_KEY_SECRET.");
}

export async function sendWhatsAppMessage(input: {
  mode: WhatsAppMode;
  phone: string;
  template: string;
  message: string;
}) {
  if (input.mode === "mock") {
    return {
      status: "SENT" as const,
      providerMessageId: `mock-wa-${Date.now()}`,
      provider: "mock"
    };
  }

  throw new Error("Connect an official WhatsApp Business API provider before production sends.");
}
