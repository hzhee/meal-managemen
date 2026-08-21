import type {
  AuditLog,
  Delivery,
  DeliveryStatus,
  Holiday,
  MealPeriod,
  NotificationRecord,
  Order,
  Student,
  SkipDate,
  WalletTransaction
} from "./types";
import type { MenuItem } from "./types";

const rupees = (amount: number) => `Rs.${Math.abs(amount).toLocaleString("en-IN")}`;
const now = () => new Date().toISOString();
const makeId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

export function calculateFoodCounts(orders: Order[], date: string, meal?: MealPeriod) {
  const confirmed = orders.filter((order) => order.date === date && order.status === "CONFIRMED" && (!meal || order.meal === meal));
  const veg = confirmed.filter((order) => order.preference === "Veg").length;
  const nonVeg = confirmed.filter((order) => order.preference === "Non-Veg").length;
  return { veg, nonVeg, total: veg + nonVeg };
}

export function createWalletTransaction(
  student: Student,
  amount: number,
  type: WalletTransaction["type"],
  description: string,
  referenceId?: string
): { student: Student; transaction: WalletTransaction } {
  const balanceBefore = student.walletBalance;
  const balanceAfter = balanceBefore + amount;

  return {
    student: { ...student, walletBalance: balanceAfter },
    transaction: {
      id: makeId("txn"),
      studentId: student.id,
      amount,
      type,
      description,
      createdAt: now(),
      referenceId,
      balanceBefore,
      balanceAfter,
      status: "SUCCESS"
    }
  };
}

export function generateOrdersForDate(args: {
  date: string;
  students: Student[];
  menus: MenuItem[];
  holidays: Holiday[];
  existingOrders: Order[];
  skips?: SkipDate[];
  lowBalanceThreshold: number;
}) {
  const orders = [...args.existingOrders];
  const transactions: WalletTransaction[] = [];
  const notifications: NotificationRecord[] = [];
  let students = [...args.students];

  if (args.holidays.some((holiday) => holiday.date === args.date) || new Date(`${args.date}T00:00:00`).getDay() === 0) {
    return { students, orders, transactions, notifications };
  }

  for (const student of students) {
    for (const meal of ["Lunch", "Dinner"] as const) {
      if (orders.some((order) => order.studentId === student.id && order.date === args.date && order.meal === meal)) continue;
      if (args.skips?.some((skip) => skip.studentId === student.id && skip.date === args.date && skip.meal === meal)) continue;
      const menu = args.menus.find((item) => item.date === args.date && item.meal === meal && item.available);
      if (!menu) continue;
      const preference = student.preferences[meal];
      const amount = preference === "Veg" ? menu.vegPrice : menu.nonVegPrice;
      const location = meal === "Lunch" ? student.lunchLocation : student.dinnerLocation;
      const order: Order = {
        id: makeId("ord"),
        studentId: student.id,
        date: args.date,
        meal,
        preference,
        amount,
        location,
        status: student.walletBalance >= amount ? "CONFIRMED" : "PAYMENT_REQUIRED"
      };
      orders.push(order);

      if (order.status === "CONFIRMED") {
        const result = createWalletTransaction(student, -amount, "MEAL_DEDUCTION", `${meal} ${preference} deduction`, order.id);
        students = students.map((record) => (record.id === student.id ? result.student : record));
        Object.assign(student, result.student);
        transactions.push(result.transaction);
        notifications.push(notification(student.id, "ORDER_CONFIRMED", "meal_confirmation", `Hi ${student.fullName}, your ${meal} order for ${args.date} is confirmed. Amount: ${rupees(amount)}. Wallet balance: ${rupees(result.student.walletBalance)}.`));
      } else {
        notifications.push(notification(student.id, "INSUFFICIENT_BALANCE", "wallet_insufficient", `Hi ${student.fullName}, your wallet balance is insufficient for ${meal} on ${args.date}. Please recharge to confirm your meal.`));
      }

      if (student.walletBalance <= args.lowBalanceThreshold) {
        notifications.push(notification(student.id, "LOW_BALANCE", "wallet_low_balance", `Hi ${student.fullName}, your Sowmy Kitchen wallet balance is ${rupees(student.walletBalance)}. Please recharge soon.`));
      }
    }
  }

  return { students, orders, transactions, notifications };
}

export function skipFutureMeal(args: { student: Student; date: string; meal: MealPeriod; reason?: string; orders: Order[]; currentDate?: string }) {
  const existing = args.orders.find((order) => order.studentId === args.student.id && order.date === args.date && order.meal === args.meal);
  const currentDate = args.currentDate ?? new Date().toISOString().slice(0, 10);
  if (args.date <= currentDate) throw new Error("Meals can only be skipped before the service date.");
  if (existing?.status === "DELIVERED" || existing?.status === "CANCELLED_HOLIDAY") throw new Error("This meal can no longer be skipped.");
  const skip: SkipDate = { id: makeId("skip"), studentId: args.student.id, date: args.date, meal: args.meal, reason: args.reason, createdAt: now() };
  let student = args.student;
  const transactions: WalletTransaction[] = [];
  const orders = args.orders.map((order) => {
    if (order !== existing) return order;
    if (order.status === "CONFIRMED") {
      const result = createWalletTransaction(student, order.amount, "REFUND", `Skipped ${order.meal} meal`, order.id);
      student = result.student;
      transactions.push(result.transaction);
    }
    return { ...order, status: "SKIPPED" as const };
  });
  return { skip, student, orders, transactions, notification: notification(args.student.id, "MEAL_SKIPPED", "meal_skipped", `Your ${args.meal} meal on ${args.date} has been skipped. ${transactions.length ? `₹${transactions[0].amount} was returned to your wallet.` : "No wallet deduction was made."}`) };
}

export function publishHoliday(args: {
  date: string;
  reason: string;
  announcement: string;
  adminName: string;
  orders: Order[];
  students: Student[];
}) {
  const holiday: Holiday = {
    id: makeId("hol"),
    date: args.date,
    reason: args.reason,
    announcement: args.announcement,
    publishedBy: args.adminName
  };
  const transactions: WalletTransaction[] = [];
  const notifications: NotificationRecord[] = [];
  let students = [...args.students];

  const orders = args.orders.map((order) => {
    if (order.date !== args.date || order.status !== "CONFIRMED") return order;
    const student = students.find((record) => record.id === order.studentId);
    if (student) {
      const result = createWalletTransaction(student, order.amount, "CANCELLATION_REFUND", `Holiday refund: ${args.reason}`, order.id);
      students = students.map((record) => (record.id === student.id ? result.student : record));
      transactions.push(result.transaction);
      notifications.push(notification(student.id, "HOLIDAY_ANNOUNCEMENT", "holiday_notice", `Sowmy Kitchen Holiday Notice: No lunch or dinner service on ${args.date} due to ${args.reason}. No meal charges will be deducted from your wallet.`));
    }
    return { ...order, status: "CANCELLED_HOLIDAY" as const };
  });

  const audit: AuditLog = {
    id: makeId("audit"),
    actor: args.adminName,
    action: "HOLIDAY_CREATED",
    entity: "holidays",
    newValue: `${args.date}: ${args.reason}`,
    createdAt: now()
  };

  return { holiday, students, orders, transactions, notifications, audit };
}

export function updateDeliveryStatus(delivery: Delivery, status: DeliveryStatus, order: Order) {
  const updated = { ...delivery, status, etaMinutes: status === "Delivered" ? 0 : Math.max(4, delivery.etaMinutes - 8) };
  const record = notification(order.studentId, "DELIVERY_STATUS_CHANGED", "delivery_status", `Your Sowmy Kitchen ${order.meal} order is now ${status}.`);
  return { delivery: updated, notification: record };
}

export function notification(studentId: string, event: string, template: string, message: string): NotificationRecord {
  return {
    id: makeId("ntf"),
    studentId,
    event,
    channel: "WHATSAPP",
    template,
    message,
    status: "SENT",
    sentAt: now(),
    retryCount: 0
  };
}
