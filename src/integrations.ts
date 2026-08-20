export type PaymentMode = "mock" | "razorpay";
export type WhatsAppMode = "mock" | "official-provider";

export interface VerifiedPayment {
  provider: "razorpay";
  paymentId: string;
  orderId: string;
  amount: number;
  verified: boolean;
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
