export type Role = "student" | "admin" | "driver";
export type MealPeriod = "Lunch" | "Dinner";
export type MealPreference = "Veg" | "Non-Veg";
export type OrderStatus = "CONFIRMED" | "PAYMENT_REQUIRED" | "SKIPPED" | "CANCELLED_HOLIDAY" | "DELIVERED";
export type TransactionType =
  | "WALLET_RECHARGE"
  | "MEAL_DEDUCTION"
  | "REFUND"
  | "MANUAL_ADJUSTMENT"
  | "PROMOTIONAL_CREDIT"
  | "CANCELLATION_REFUND";
export type DeliveryStatus = "Assigned" | "Preparing" | "Ready" | "Out for Delivery" | "Delivered";

export interface Student {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  college: string;
  hostel: string;
  roomNumber: string;
  lunchLocation: string;
  dinnerLocation: string;
  lunchTiming: string;
  dinnerTiming: string;
  preferences: Record<MealPeriod, MealPreference>;
  subscriptionPlan: string;
  walletBalance: number;
  lowBalanceNotifiedAt?: string;
}

export interface SkipDate {
  id: string;
  studentId: string;
  date: string;
  meal: MealPeriod;
  reason?: string;
  createdAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  active: boolean;
  createdAt: string;
}

export interface MenuItem {
  date: string;
  meal: MealPeriod;
  vegOption: string;
  nonVegOption: string;
  vegPrice: number;
  nonVegPrice: number;
  available: boolean;
  description: string;
}

export interface Order {
  id: string;
  studentId: string;
  date: string;
  meal: MealPeriod;
  preference: MealPreference;
  amount: number;
  status: OrderStatus;
  location: string;
  deliveryId?: string;
}

export interface WalletTransaction {
  id: string;
  studentId: string;
  amount: number;
  type: TransactionType;
  description: string;
  createdAt: string;
  referenceId?: string;
  balanceBefore: number;
  balanceAfter: number;
  status: "PENDING" | "SUCCESS" | "FAILED";
}

export interface Holiday {
  id: string;
  date: string;
  reason: string;
  announcement: string;
  publishedBy: string;
}

export interface NotificationRecord {
  id: string;
  studentId?: string;
  event: string;
  channel: "IN_APP" | "WHATSAPP";
  template: string;
  message: string;
  status: "PENDING" | "SENT" | "DELIVERED" | "FAILED" | "READ";
  sentAt?: string;
  retryCount: number;
}

export interface Delivery {
  id: string;
  orderId: string;
  driverId: string;
  status: DeliveryStatus;
  etaMinutes: number;
  lat: number;
  lng: number;
}

export interface Review {
  id: string;
  studentName: string;
  stars: number;
  text: string;
  approved: boolean;
  featured: boolean;
}

export interface AuditLog {
  id: string;
  actor: string;
  action: string;
  entity: string;
  oldValue?: string;
  newValue: string;
  createdAt: string;
}
