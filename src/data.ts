import type { Announcement, Delivery, Holiday, MenuItem, NotificationRecord, Order, Review, SkipDate, Student, WalletTransaction } from "./types";

export const today = "2026-08-20";
export const tomorrow = "2026-08-21";

export const initialStudents: Student[] = [
  {
    id: "stu-001",
    fullName: "Ananya R",
    phone: "+91 98765 43210",
    email: "ananya@student.saveetha.edu",
    college: "SIMATS",
    hostel: "Lotus Hostel",
    roomNumber: "B-214",
    lunchLocation: "Main Gate Counter",
    dinnerLocation: "Lotus Hostel Lobby",
    lunchTiming: "12:30 PM",
    dinnerTiming: "7:30 PM",
    preferences: { Lunch: "Veg", Dinner: "Non-Veg" },
    subscriptionPlan: "Monthly Lunch + Dinner",
    walletBalance: 1000
  },
  {
    id: "stu-002",
    fullName: "Vikram S",
    phone: "+91 98765 43444",
    email: "vikram@student.saveetha.edu",
    college: "Saveetha Engineering College",
    hostel: "Pearl Hostel",
    roomNumber: "C-118",
    lunchLocation: "Dental Block",
    dinnerLocation: "Pearl Hostel Lobby",
    lunchTiming: "1:00 PM",
    dinnerTiming: "8:00 PM",
    preferences: { Lunch: "Non-Veg", Dinner: "Veg" },
    subscriptionPlan: "Weekly Flexible",
    walletBalance: 160
  }
];

export const initialMenus: MenuItem[] = [
  {
    date: today,
    meal: "Lunch",
    vegOption: "Lemon rice, sambar, poriyal, curd",
    nonVegOption: "Chicken curry, rice, rasam, poriyal",
    vegPrice: 70,
    nonVegPrice: 90,
    available: true,
    description: "Balanced student lunch with fresh sides"
  },
  {
    date: today,
    meal: "Dinner",
    vegOption: "Chapati, paneer gravy, dal, salad",
    nonVegOption: "Egg curry, chapati, dal, salad",
    vegPrice: 70,
    nonVegPrice: 85,
    available: true,
    description: "Light dinner for hostel delivery"
  },
  {
    date: tomorrow,
    meal: "Lunch",
    vegOption: "Tomato rice, kootu, appalam, curd",
    nonVegOption: "Fish fry, rice, kulambu, rasam",
    vegPrice: 70,
    nonVegPrice: 95,
    available: true,
    description: "Friday lunch menu"
  },
  {
    date: tomorrow,
    meal: "Dinner",
    vegOption: "Veg biryani, raita, sweet",
    nonVegOption: "Chicken biryani, raita, sweet",
    vegPrice: 80,
    nonVegPrice: 110,
    available: true,
    description: "Weekend-special dinner"
  }
];

export const initialOrders: Order[] = [
  { id: "ord-1001", studentId: "stu-001", date: today, meal: "Lunch", preference: "Veg", amount: 70, status: "CONFIRMED", location: "Main Gate Counter", deliveryId: "del-9001" },
  { id: "ord-1002", studentId: "stu-001", date: today, meal: "Dinner", preference: "Non-Veg", amount: 85, status: "CONFIRMED", location: "Lotus Hostel Lobby", deliveryId: "del-9002" },
  { id: "ord-1003", studentId: "stu-002", date: today, meal: "Lunch", preference: "Non-Veg", amount: 90, status: "CONFIRMED", location: "Dental Block", deliveryId: "del-9003" },
  { id: "ord-1004", studentId: "stu-002", date: today, meal: "Dinner", preference: "Veg", amount: 70, status: "PAYMENT_REQUIRED", location: "Pearl Hostel Lobby" }
];

export const initialTransactions: WalletTransaction[] = [
  {
    id: "txn-7001",
    studentId: "stu-001",
    amount: 1000,
    type: "WALLET_RECHARGE",
    description: "Verified Razorpay test recharge",
    createdAt: "2026-08-19T08:45:00.000Z",
    balanceBefore: 0,
    balanceAfter: 1000,
    status: "SUCCESS"
  },
  {
    id: "txn-7002",
    studentId: "stu-001",
    amount: -70,
    type: "MEAL_DEDUCTION",
    description: "Lunch Veg deduction",
    createdAt: "2026-08-20T05:30:00.000Z",
    referenceId: "ord-1001",
    balanceBefore: 1000,
    balanceAfter: 930,
    status: "SUCCESS"
  }
];

export const initialNotifications: NotificationRecord[] = [
  {
    id: "ntf-5001",
    studentId: "stu-001",
    event: "ORDER_CONFIRMED",
    channel: "WHATSAPP",
    template: "meal_confirmation",
    message: "Hi Ananya R, your Lunch order for 2026-08-20 is confirmed. Amount: Rs.70. Wallet balance: Rs.930.",
    status: "DELIVERED",
    sentAt: "2026-08-20T05:31:00.000Z",
    retryCount: 0
  }
];

export const initialDeliveries: Delivery[] = [
  { id: "del-9001", orderId: "ord-1001", driverId: "drv-001", status: "Ready", etaMinutes: 12, lat: 13.0302, lng: 80.0151 },
  { id: "del-9002", orderId: "ord-1002", driverId: "drv-001", status: "Assigned", etaMinutes: 40, lat: 13.0301, lng: 80.0154 },
  { id: "del-9003", orderId: "ord-1003", driverId: "drv-002", status: "Preparing", etaMinutes: 22, lat: 13.0298, lng: 80.0149 }
];

export const initialSkips: SkipDate[] = [];

export const initialAnnouncements: Announcement[] = [
  { id: "ann-001", title: "Friday dinner special", body: "Chicken and veg biryani are on the menu this Friday. Please recharge before 10 AM to confirm your meal.", active: true, createdAt: "2026-08-19T09:00:00.000Z" }
];

export const initialHolidays: Holiday[] = [];

export const reviews: Review[] = [
  { id: "rev-1", studentName: "Harini P", stars: 5, text: "The wallet system makes it easy to plan meals for the week.", approved: true, featured: true },
  { id: "rev-2", studentName: "Rahul N", stars: 4, text: "Dinner delivery to the hostel is much more predictable now.", approved: true, featured: true },
  { id: "rev-3", studentName: "Meena K", stars: 5, text: "Homemade taste and clear daily updates.", approved: true, featured: false }
];
