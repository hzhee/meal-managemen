import { FormEvent, useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  IndianRupee,
  LayoutDashboard,
  MapPin,
  Megaphone,
  MessageCircle,
  Plus,
  ShieldCheck,
  Star,
  Truck,
  UserPlus,
  X,
  CircleCheck,
  Users,
  Utensils,
  Wallet
} from "lucide-react";
import {
  initialDeliveries,
  initialHolidays,
  initialMenus,
  initialNotifications,
  initialOrders,
  initialStudents,
  initialTransactions,
  initialAnnouncements,
  initialSkips,
  reviews,
  today,
  tomorrow
} from "./data";
import { calculateFoodCounts, createWalletTransaction, generateOrdersForDate, publishHoliday, skipFutureMeal, updateDeliveryStatus } from "./business";
import { verifyRazorpayPayment } from "./integrations";
import type { Announcement, AuditLog, Delivery, DeliveryStatus, Holiday, MenuItem, NotificationRecord, Order, Role, SkipDate, Student, WalletTransaction } from "./types";

const money = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;

export function App() {
  const [role, setRole] = useState<Role | null>(null);
  const [students, setStudents] = useState<Student[]>(initialStudents);
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [menus, setMenus] = useState<MenuItem[]>(initialMenus);
  const [holidays, setHolidays] = useState<Holiday[]>(initialHolidays);
  const [transactions, setTransactions] = useState<WalletTransaction[]>(initialTransactions);
  const [notifications, setNotifications] = useState<NotificationRecord[]>(initialNotifications);
  const [deliveries, setDeliveries] = useState<Delivery[]>(initialDeliveries);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [skips, setSkips] = useState<SkipDate[]>(initialSkips);
  const [announcements] = useState<Announcement[]>(initialAnnouncements);
  const [showRegister, setShowRegister] = useState(false);
  const [showStaffAccess, setShowStaffAccess] = useState(false);
  const [toast, setToast] = useState("System ready. Demo integrations are clearly labelled.");
  const selectedStudent = students[0];

  const counts = useMemo(() => ({
    lunch: calculateFoodCounts(orders, today, "Lunch"),
    dinner: calculateFoodCounts(orders, today, "Dinner")
  }), [orders]);

  function rechargeWallet(amount: number) {
    void verifyRazorpayPayment({ mode: "mock", paymentId: `pay_${Date.now()}`, orderId: `rzp_${Date.now()}`, amount }).then((payment) => {
      if (!payment.verified) return;
      const result = createWalletTransaction(selectedStudent, amount, "WALLET_RECHARGE", "Verified Razorpay mock recharge", payment.orderId);
      setStudents((records) => records.map((student) => (student.id === selectedStudent.id ? result.student : student)));
      setTransactions((records) => [result.transaction, ...records]);
      setNotifications((records) => [
        {
          id: `ntf-${Date.now()}`,
          studentId: selectedStudent.id,
          event: "WALLET_RECHARGE_SUCCESS",
          channel: "WHATSAPP",
          template: "wallet_recharge_success",
          message: `Hi ${selectedStudent.fullName}, ${money(amount)} was added to your Sowmy Kitchen wallet after server verification.`,
          status: "SENT",
          sentAt: new Date().toISOString(),
          retryCount: 0
        },
        ...records
      ]);
      setToast(`${money(amount)} credited after mock Razorpay verification.`);
    });
  }

  function runDailyAutomation() {
    const result = generateOrdersForDate({
      date: tomorrow,
      students,
      menus,
      holidays,
      existingOrders: orders,
      skips,
      lowBalanceThreshold: 200
    });
    setStudents(result.students);
    setOrders(result.orders);
    setTransactions((records) => [...result.transactions, ...records]);
    setNotifications((records) => [...result.notifications, ...records]);
    setToast(`Daily automation generated ${result.orders.length - orders.length} new order records for ${tomorrow}.`);
  }

  function skipMeal(date: string, meal: "Lunch" | "Dinner") {
    try {
      const result = skipFutureMeal({ student: selectedStudent, date, meal, reason: "Student requested skip", orders });
      setSkips((records) => [result.skip, ...records]);
      setStudents((records) => records.map((student) => student.id === selectedStudent.id ? result.student : student));
      setOrders(result.orders);
      setTransactions((records) => [...result.transactions, ...records]);
      setNotifications((records) => [result.notification, ...records]);
      setToast(`${meal} on ${date} was skipped. ${result.transactions.length ? "Your wallet was refunded." : "No charge was made."}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not skip this meal.");
    }
  }

  function updateStudentProfile(updated: Student) {
    setStudents((records) => records.map((student) => student.id === updated.id ? updated : student));
    setToast("Your meal profile was updated. New preferences apply to future automated orders.");
  }

  function registerStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fullName = String(form.get("fullName") || "").trim();
    const phone = String(form.get("phone") || "").trim();
    const email = String(form.get("email") || "").trim();
    if (!fullName || !phone || !email) { setToast("Please complete your name, phone number and email."); return; }
    const student: Student = {
      id: `stu-${Date.now()}`, fullName, phone, email,
      college: String(form.get("college") || "Saveetha"), hostel: String(form.get("hostel") || ""), roomNumber: String(form.get("room") || ""),
      lunchLocation: String(form.get("lunchLocation") || "Main Gate Counter"), dinnerLocation: String(form.get("dinnerLocation") || "Hostel Lobby"),
      lunchTiming: String(form.get("lunchTiming") || "12:30 PM"), dinnerTiming: String(form.get("dinnerTiming") || "7:30 PM"),
      preferences: { Lunch: String(form.get("lunchPreference") || "Veg") as "Veg" | "Non-Veg", Dinner: String(form.get("dinnerPreference") || "Veg") as "Veg" | "Non-Veg" },
      subscriptionPlan: String(form.get("plan") || "Weekly Flexible"), walletBalance: 0
    };
    setStudents((records) => [...records, student]);
    setShowRegister(false); setRole("student");
    setToast(`Welcome, ${student.fullName}. Your account is ready — recharge to activate your first meal.`);
  }

  function createHoliday() {
    const result = publishHoliday({
      date: tomorrow,
      reason: "College Holiday",
      announcement: "No lunch or dinner service. No wallet deduction for the holiday.",
      adminName: "Sowmy Kitchen Owner",
      orders,
      students
    });
    setHolidays((records) => [result.holiday, ...records]);
    setStudents(result.students);
    setOrders(result.orders);
    setTransactions((records) => [...result.transactions, ...records]);
    setNotifications((records) => [...result.notifications, ...records]);
    setAuditLogs((records) => [result.audit, ...records]);
    setToast(`Holiday published for ${tomorrow}. Confirmed orders were cancelled and refunded.`);
  }

  function addMenu(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const date = String(form.get("date"));
    const meal = String(form.get("meal")) as "Lunch" | "Dinner";
    const vegOption = String(form.get("vegOption")).trim();
    const nonVegOption = String(form.get("nonVegOption")).trim();
    const vegPrice = Number(form.get("vegPrice"));
    const nonVegPrice = Number(form.get("nonVegPrice"));
    if (!date || !vegOption || !nonVegOption || !Number.isFinite(vegPrice) || !Number.isFinite(nonVegPrice)) { setToast("Complete every menu field with valid prices."); return; }
    const record: MenuItem = { date, meal, vegOption, nonVegOption, vegPrice, nonVegPrice, available: true, description: String(form.get("description") || "Freshly prepared meal") };
    setMenus((items) => [record, ...items.filter((item) => !(item.date === date && item.meal === meal))]);
    setAuditLogs((logs) => [{ id: `audit-${Date.now()}`, actor: "Sowmy Kitchen Owner", action: "MENU_UPDATED", entity: "menus", newValue: `${date} ${meal}: Veg ₹${vegPrice}, Non-Veg ₹${nonVegPrice}`, createdAt: new Date().toISOString() }, ...logs]);
    event.currentTarget.reset();
    setToast(`${meal} menu for ${date} is live and will be used by daily automation.`);
  }

  function assignDelivery(orderId: string, driverId: string) {
    const order = orders.find((record) => record.id === orderId);
    if (!order || order.deliveryId) { setToast("Choose an unassigned confirmed order."); return; }
    const id = `del-${Date.now()}`;
    setOrders((records) => records.map((record) => record.id === orderId ? { ...record, deliveryId: id } : record));
    setDeliveries((records) => [...records, { id, orderId, driverId, status: "Assigned", etaMinutes: 35, lat: 13.0302, lng: 80.0151 }]);
    setNotifications((records) => [{ id: `ntf-${Date.now()}`, studentId: order.studentId, event: "DELIVERY_ASSIGNED", channel: "IN_APP", template: "delivery_assigned", message: `Your ${order.meal} order has been assigned to a delivery partner.`, status: "SENT", sentAt: new Date().toISOString(), retryCount: 0 }, ...records]);
    setAuditLogs((logs) => [{ id: `audit-${Date.now()}`, actor: "Sowmy Kitchen Owner", action: "DELIVERY_ASSIGNED", entity: "deliveries", newValue: `${orderId} assigned to ${driverId}`, createdAt: new Date().toISOString() }, ...logs]);
    setToast("Delivery partner assigned. Student notification created.");
  }

  function advanceDelivery(delivery: Delivery) {
    const flow: DeliveryStatus[] = ["Assigned", "Preparing", "Ready", "Out for Delivery", "Delivered"];
    const current = flow.indexOf(delivery.status);
    const next = flow[Math.min(current + 1, flow.length - 1)];
    const order = orders.find((record) => record.id === delivery.orderId)!;
    const result = updateDeliveryStatus(delivery, next, order);
    setDeliveries((records) => records.map((record) => (record.id === delivery.id ? result.delivery : record)));
    setNotifications((records) => [result.notification, ...records]);
    if (next === "Delivered") {
      setOrders((records) => records.map((record) => (record.id === order.id ? { ...record, status: "DELIVERED" } : record)));
    }
    setToast(`Delivery ${delivery.id} moved to ${next}. Student notification queued.`);
  }

  return (
    <div>
      <header className="site-header">
        <a className="brand" href="#home" aria-label="Sowmy Kitchen home">
          <span className="brand-mark">SK</span>
          <span>Sowmy Kitchen</span>
        </a>
        {role ? <button className="header-join" onClick={() => { setRole(null); setToast("You have been logged out safely."); }}>Log out</button> : <><button className="header-join" onClick={() => setShowRegister(true)}><UserPlus size={16} /> Join now</button><button className="staff-link" onClick={() => setShowStaffAccess(true)}>Sign in</button></>}
      </header>

      <main id="home">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Student meals near Saveetha and SIMATS</p>
            <h1>Sowmy Kitchen</h1>
            <p>
              A connected meal-management platform for subscriptions, wallet recharge, daily order automation,
              holidays, delivery updates, WhatsApp notifications, and owner dashboards.
            </p>
            <div className="hero-actions">
              <button onClick={() => setShowRegister(true)}><UserPlus size={18} /> Start your plan</button>
              <button className="secondary" onClick={() => setShowStaffAccess(true)}><LayoutDashboard size={18} /> Sign in</button>
            </div>
          </div>
          <div className="hero-media" aria-label="Fresh homemade South Indian meals">
            <img
              src="https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=1200&q=80"
              alt="Fresh Indian meal served in bowls"
            />
            <div className="hero-stat">
              <Utensils size={18} />
              <span>{counts.lunch.total + counts.dinner.total} confirmed meals today</span>
            </div>
          </div>
        </section>

        {role && <section className="app-shell">
          <aside className="side-panel">
            <div className="owner-card">
              <ShieldCheck size={22} />
              <div>
                <strong>Production controls</strong>
                <span>Backend authorization, audit logs, idempotent jobs, verified payments.</span>
              </div>
            </div>
            <StatusList holidays={holidays} transactions={transactions} notifications={notifications} />
          </aside>

          <section className="workspace" aria-live="polite">
            <div className="toast"><Bell size={16} /> {toast}</div>
            {role === "student" && <StudentDashboard student={selectedStudent} orders={orders} transactions={transactions} notifications={notifications} announcements={announcements} skips={skips} onRecharge={rechargeWallet} onSkip={skipMeal} onUpdateProfile={updateStudentProfile} />}
            {role === "admin" && (
              <AdminDashboard
                students={students}
                orders={orders}
                holidays={holidays}
                notifications={notifications}
                auditLogs={auditLogs}
                counts={counts}
                menus={menus}
                deliveries={deliveries}
                onDailyAutomation={runDailyAutomation}
                onHoliday={createHoliday}
                onAddMenu={addMenu}
                onAssignDelivery={assignDelivery}
              />
            )}
            {role === "driver" && <DriverDashboard deliveries={deliveries} orders={orders} students={students} onAdvance={advanceDelivery} />}
          </section>
        </section>}

        <MarketingSections />
      </main>
      {showRegister && <RegistrationDialog onClose={() => setShowRegister(false)} onSubmit={registerStudent} />}
      {showStaffAccess && <StaffAccessDialog onClose={() => setShowStaffAccess(false)} onSelect={(selectedRole) => { setRole(selectedRole); setShowStaffAccess(false); setToast(`${selectedRole === "admin" ? "Owner" : selectedRole === "driver" ? "Driver" : "Student"} workspace opened in development mode.`); }} />}
    </div>
  );
}

function StudentDashboard(props: {
  student: Student;
  orders: Order[];
  transactions: WalletTransaction[];
  notifications: NotificationRecord[];
  announcements: Announcement[];
  skips: SkipDate[];
  onRecharge: (amount: number) => void;
  onSkip: (date: string, meal: "Lunch" | "Dinner") => void;
  onUpdateProfile: (student: Student) => void;
}) {
  const studentOrders = props.orders.filter((order) => order.studentId === props.student.id);
  const todays = studentOrders.filter((order) => order.date === today);
  const nextMeals = studentOrders.filter((order) => order.date >= today).slice(0, 4);
  const [customRecharge, setCustomRecharge] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  return (
    <div className="view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">Student dashboard</p>
          <h2>Hi, {props.student.fullName}</h2>
        </div>
        <div className="balance"><Wallet size={18} /> {money(props.student.walletBalance)}</div>
      </div>
      <button className="profile-button secondary" onClick={() => setShowProfile(true)}><UserPlus size={16} /> Edit meal profile</button>
      <div className="metric-grid">
        <Metric icon={<Utensils />} label="Lunch" value={todays.find((order) => order.meal === "Lunch")?.status ?? "Not generated"} />
        <Metric icon={<CalendarDays />} label="Dinner" value={todays.find((order) => order.meal === "Dinner")?.status ?? "Not generated"} />
        <Metric icon={<MapPin />} label="Dinner location" value={props.student.dinnerLocation} />
      </div>
      <section className="today-card">
        <div><span className="live-dot" /> TODAY AT A GLANCE</div>
        <strong>{todays.length ? `${todays.filter((order) => order.status === "CONFIRMED").length} of ${todays.length} meals confirmed` : "Your meals are being prepared"}</strong>
        <p>Your recurring preference, timings, and collection point are automatically applied each day.</p>
      </section>
      <div className="split">
        <Panel title="Quick actions">
          <div className="amount-grid">
            {[100, 250, 500, 1000, 2000].map((amount) => (
              <button key={amount} onClick={() => props.onRecharge(amount)}>
                <CreditCard size={16} /> {money(amount)}
              </button>
            ))}
          </div>
          <div className="custom-recharge">
            <input aria-label="Custom recharge amount" inputMode="numeric" placeholder="Custom amount" value={customRecharge} onChange={(event) => setCustomRecharge(event.target.value.replace(/\D/g, ""))} />
            <button className="secondary" onClick={() => { const amount = Number(customRecharge); if (amount >= 10) { props.onRecharge(amount); setCustomRecharge(""); } }}>Add funds</button>
          </div>
        </Panel>
        <Panel title="Upcoming meals">
          <div className="list">
            {nextMeals.map((order) => (
              <div className="meal-row" key={order.id}>
                <Row title={`${order.date} · ${order.meal}`} detail={`${order.preference} · ${money(order.amount)} · ${order.status}`} />
                {order.date > today && order.status !== "SKIPPED" && <button className="text-button" onClick={() => props.onSkip(order.date, order.meal)}>Skip</button>}
              </div>
            ))}
            {props.skips.filter((skip) => skip.studentId === props.student.id).slice(0, 2).map((skip) => <Row key={skip.id} title={`${skip.date} · ${skip.meal}`} detail="Skipped — no meal will be prepared or charged" />)}
          </div>
        </Panel>
      </div>
      <div className="split">
        <Panel title="Wallet ledger">
          <div className="list">
            {props.transactions.filter((txn) => txn.studentId === props.student.id).slice(0, 5).map((txn) => (
              <Row key={txn.id} title={txn.type.replaceAll("_", " ")} detail={`${txn.amount < 0 ? "-" : "+"}${money(Math.abs(txn.amount))} · Balance ${money(txn.balanceAfter)}`} />
            ))}
          </div>
        </Panel>
        <Panel title="Kitchen updates">
          <div className="list">
            {props.announcements.filter((announcement) => announcement.active).map((announcement) => <Row key={announcement.id} title={announcement.title} detail={announcement.body} />)}
            {props.notifications.filter((item) => item.studentId === props.student.id).slice(0, 2).map((item) => <Row key={item.id} title={item.event.replaceAll("_", " ")} detail={item.message} />)}
          </div>
        </Panel>
      </div>
      {showProfile && <StudentProfileDialog student={props.student} onClose={() => setShowProfile(false)} onSave={(student) => { props.onUpdateProfile(student); setShowProfile(false); }} />}
    </div>
  );
}

function StudentProfileDialog(props: { student: Student; onClose: () => void; onSave: (student: Student) => void }) {
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    props.onSave({
      ...props.student,
      fullName: String(form.get("fullName") || props.student.fullName).trim(),
      phone: String(form.get("phone") || props.student.phone).trim(),
      college: String(form.get("college") || props.student.college).trim(),
      hostel: String(form.get("hostel") || props.student.hostel).trim(),
      roomNumber: String(form.get("room") || props.student.roomNumber).trim(),
      lunchLocation: String(form.get("lunchLocation") || props.student.lunchLocation).trim(),
      dinnerLocation: String(form.get("dinnerLocation") || props.student.dinnerLocation).trim(),
      lunchTiming: String(form.get("lunchTiming") || props.student.lunchTiming).trim(),
      dinnerTiming: String(form.get("dinnerTiming") || props.student.dinnerTiming).trim(),
      preferences: { Lunch: String(form.get("lunchPreference")) as "Veg" | "Non-Veg", Dinner: String(form.get("dinnerPreference")) as "Veg" | "Non-Veg" },
      subscriptionPlan: String(form.get("plan") || props.student.subscriptionPlan)
    });
  }
  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="registration-dialog profile-dialog" onSubmit={save}>
        <div className="dialog-heading"><div><p className="eyebrow">Your meal settings</p><h2>Make it work for you.</h2><p>These choices are used for future meal orders. Existing confirmed meals stay unchanged.</p></div><button type="button" className="icon-button" onClick={props.onClose} aria-label="Close meal profile"><X size={20} /></button></div>
        <div className="form-grid">
          <label>Full name<input name="fullName" defaultValue={props.student.fullName} required /></label>
          <label>Phone number<input name="phone" defaultValue={props.student.phone} required /></label>
          <label>College<input name="college" defaultValue={props.student.college} required /></label>
          <label>Hostel<input name="hostel" defaultValue={props.student.hostel} required /></label>
          <label>Room number<input name="room" defaultValue={props.student.roomNumber} required /></label>
          <label>Subscription plan<select name="plan" defaultValue={props.student.subscriptionPlan}><option>Weekly Flexible</option><option>Monthly Lunch + Dinner</option><option>Exam Week Support</option></select></label>
          <label>Lunch location<input name="lunchLocation" defaultValue={props.student.lunchLocation} required /></label>
          <label>Lunch timing<input name="lunchTiming" defaultValue={props.student.lunchTiming} required /></label>
          <label>Lunch preference<select name="lunchPreference" defaultValue={props.student.preferences.Lunch}><option>Veg</option><option>Non-Veg</option></select></label>
          <label>Dinner location<input name="dinnerLocation" defaultValue={props.student.dinnerLocation} required /></label>
          <label>Dinner timing<input name="dinnerTiming" defaultValue={props.student.dinnerTiming} required /></label>
          <label>Dinner preference<select name="dinnerPreference" defaultValue={props.student.preferences.Dinner}><option>Veg</option><option>Non-Veg</option></select></label>
        </div>
        <div className="form-footer"><span><CircleCheck size={16} /> Changes apply to future generated meals.</span><button type="submit">Save my settings <ChevronRight size={17} /></button></div>
      </form>
    </div>
  );
}

function AdminDashboard(props: {
  students: Student[];
  orders: Order[];
  holidays: Holiday[];
  notifications: NotificationRecord[];
  auditLogs: AuditLog[];
  counts: { lunch: ReturnType<typeof calculateFoodCounts>; dinner: ReturnType<typeof calculateFoodCounts> };
  menus: MenuItem[];
  deliveries: Delivery[];
  onDailyAutomation: () => void;
  onHoliday: () => void;
  onAddMenu: (event: FormEvent<HTMLFormElement>) => void;
  onAssignDelivery: (orderId: string, driverId: string) => void;
}) {
  const revenue = props.orders.filter((order) => order.status === "CONFIRMED" || order.status === "DELIVERED").reduce((sum, order) => sum + order.amount, 0);
  const pending = props.orders.filter((order) => order.status === "PAYMENT_REQUIRED").length;
  return (
    <div className="view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">Owner dashboard</p>
          <h2>One place to run the kitchen</h2>
        </div>
        <div className="toolbar">
          <button onClick={props.onDailyAutomation}><Plus size={16} /> Run daily jobs</button>
          <button className="danger" onClick={props.onHoliday}><Megaphone size={16} /> Publish holiday</button>
        </div>
      </div>
      <div className="metric-grid admin-metrics">
        <Metric icon={<Users />} label="Active students" value={props.students.length.toString()} />
        <Metric icon={<Utensils />} label="Lunch count" value={`${props.counts.lunch.veg} Veg / ${props.counts.lunch.nonVeg} Non-Veg`} />
        <Metric icon={<Utensils />} label="Dinner count" value={`${props.counts.dinner.veg} Veg / ${props.counts.dinner.nonVeg} Non-Veg`} />
        <Metric icon={<IndianRupee />} label="Confirmed revenue" value={money(revenue)} />
        <Metric icon={<CreditCard />} label="Pending payments" value={pending.toString()} />
        <Metric icon={<MessageCircle />} label="WhatsApp sent" value={props.notifications.length.toString()} />
      </div>
      <div className="split">
        <Panel title="Publish today's menu">
          <form className="admin-form" onSubmit={props.onAddMenu}>
            <div className="admin-form-grid">
              <label>Date<input type="date" name="date" defaultValue={today} required /></label>
              <label>Meal<select name="meal"><option>Lunch</option><option>Dinner</option></select></label>
              <label>Veg option<input name="vegOption" placeholder="e.g. Sambar rice, poriyal" required /></label>
              <label>Veg price<input name="vegPrice" type="number" min="0" placeholder="70" required /></label>
              <label>Non-Veg option<input name="nonVegOption" placeholder="e.g. Chicken rice, rasam" required /></label>
              <label>Non-Veg price<input name="nonVegPrice" type="number" min="0" placeholder="90" required /></label>
              <label className="full-span">Description<input name="description" placeholder="Short note for students" /></label>
            </div>
            <button type="submit"><Plus size={16} /> Publish menu</button>
          </form>
          <div className="compact-list">{props.menus.filter((menu) => menu.date === today).map((menu) => <span key={`${menu.date}-${menu.meal}`}>{menu.meal}: {menu.vegOption} / {menu.nonVegOption}</span>)}</div>
        </Panel>
        <Panel title="Assign delivery partner">
          <div className="list">
            {props.orders.filter((order) => order.status === "CONFIRMED" && !order.deliveryId).slice(0, 4).map((order) => (
              <div className="assignment-row" key={order.id}>
                <div><strong>{order.id} · {order.meal} · {order.preference}</strong><span>{order.location}</span></div>
                <select aria-label={`Assign driver for ${order.id}`} defaultValue="" onChange={(event) => event.target.value && props.onAssignDelivery(order.id, event.target.value)}>
                  <option value="">Assign partner</option><option value="drv-001">Karthik · Driver</option><option value="drv-002">Dinesh · Driver</option>
                </select>
              </div>
            ))}
            {props.orders.filter((order) => order.status === "CONFIRMED" && !order.deliveryId).length === 0 && <Row title="All confirmed orders assigned" detail={`${props.deliveries.length} deliveries currently in the workflow.`} />}
          </div>
        </Panel>
      </div>
      <div className="split">
        <Panel title="Food preparation">
          <PrepBar label="Lunch Veg" value={props.counts.lunch.veg} max={8} />
          <PrepBar label="Lunch Non-Veg" value={props.counts.lunch.nonVeg} max={8} />
          <PrepBar label="Dinner Veg" value={props.counts.dinner.veg} max={8} />
          <PrepBar label="Dinner Non-Veg" value={props.counts.dinner.nonVeg} max={8} />
        </Panel>
        <Panel title="Holiday automation">
          <div className="list">
            {props.holidays.length === 0 ? <Row title="No published holidays" detail="Publishing a holiday cancels eligible orders, prevents deductions, sends notices, and writes audit logs." /> : null}
            {props.holidays.map((holiday) => <Row key={holiday.id} title={`${holiday.date} · ${holiday.reason}`} detail={holiday.announcement} />)}
          </div>
        </Panel>
      </div>
      <div className="split">
        <Panel title="Order control">
          <div className="list">
            {props.orders.slice(0, 6).map((order) => (
              <Row key={order.id} title={`${order.id} · ${order.meal} · ${order.preference}`} detail={`${order.date} · ${order.status} · ${money(order.amount)} · ${order.location}`} />
            ))}
          </div>
        </Panel>
        <Panel title="Audit trail">
          <div className="list">
            {props.auditLogs.length === 0 ? <Row title="No sensitive admin action yet" detail="Holiday, price, wallet, driver, and configuration changes are recorded here." /> : null}
            {props.auditLogs.map((log) => <Row key={log.id} title={log.action} detail={`${log.actor} · ${log.newValue}`} />)}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function DriverDashboard(props: {
  deliveries: Delivery[];
  orders: Order[];
  students: Student[];
  onAdvance: (delivery: Delivery) => void;
}) {
  return (
    <div className="view">
      <div className="view-heading">
        <div>
          <p className="eyebrow">Driver dashboard</p>
          <h2>Assigned deliveries</h2>
        </div>
        <div className="balance"><Truck size={18} /> Active route</div>
      </div>
      <div className="delivery-grid">
        {props.deliveries.map((delivery) => {
          const order = props.orders.find((record) => record.id === delivery.orderId)!;
          const student = props.students.find((record) => record.id === order.studentId)!;
          return (
            <article className="delivery-card" key={delivery.id}>
              <div className="delivery-map">
                <MapPin size={26} />
                <span>{delivery.lat.toFixed(3)}, {delivery.lng.toFixed(3)}</span>
              </div>
              <div>
                <p className="eyebrow">{order.meal} · {order.preference}</p>
                <h3>{student.fullName}</h3>
                <p>{order.location} · ETA {delivery.etaMinutes} min</p>
              </div>
              <div className="status-row">
                <span>{delivery.status}</span>
                <button onClick={() => props.onAdvance(delivery)}>
                  Advance <ChevronRight size={16} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function RegistrationDialog(props: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="registration-dialog" onSubmit={props.onSubmit}>
        <div className="dialog-heading">
          <div><p className="eyebrow">Student registration</p><h2>Meals that fit your routine.</h2><p>Set your locations and preferences once. You stay in control with skips and wallet-based confirmations.</p></div>
          <button type="button" className="icon-button" onClick={props.onClose} aria-label="Close registration"><X size={20} /></button>
        </div>
        <div className="form-grid">
          <label>Full name<input name="fullName" placeholder="Your name" required /></label>
          <label>Phone number<input name="phone" inputMode="tel" placeholder="+91 98765 43210" required /></label>
          <label>Email<input name="email" type="email" placeholder="you@college.edu" required /></label>
          <label>College<input name="college" placeholder="Saveetha / SIMATS" required /></label>
          <label>Hostel<input name="hostel" placeholder="Hostel name" required /></label>
          <label>Room number<input name="room" placeholder="B-214" required /></label>
          <label>Lunch collection point<input name="lunchLocation" placeholder="Main Gate Counter" required /></label>
          <label>Dinner collection point<input name="dinnerLocation" placeholder="Hostel lobby" required /></label>
          <label>Lunch timing<input name="lunchTiming" defaultValue="12:30 PM" required /></label>
          <label>Dinner timing<input name="dinnerTiming" defaultValue="7:30 PM" required /></label>
          <label>Lunch preference<select name="lunchPreference"><option>Veg</option><option>Non-Veg</option></select></label>
          <label>Dinner preference<select name="dinnerPreference"><option>Veg</option><option>Non-Veg</option></select></label>
          <label className="form-wide">Plan<select name="plan"><option>Weekly Flexible</option><option>Monthly Lunch + Dinner</option><option>Exam Week Support</option></select></label>
        </div>
        <div className="form-footer"><span><CircleCheck size={16} /> Your payment details are never stored here.</span><button type="submit">Create student account <ChevronRight size={17} /></button></div>
      </form>
    </div>
  );
}

function StaffAccessDialog(props: { onClose: () => void; onSelect: (role: Role) => void }) {
  const [error, setError] = useState("");
  function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    if (password !== "sowmy-demo") { setError("Incorrect email or password."); return; }
    if (email === "student@sowmykitchen.test") { props.onSelect("student"); return; }
    if (email === "owner@sowmykitchen.test") { props.onSelect("admin"); return; }
    if (email === "driver@sowmykitchen.test") { props.onSelect("driver"); return; }
    setError("This account is not authorized for a Sowmy Kitchen workspace.");
  }
  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="staff-dialog" aria-label="Account sign in" onSubmit={signIn}>
        <button type="button" className="icon-button staff-close" onClick={props.onClose} aria-label="Close sign in"><X size={20} /></button>
        <p className="eyebrow">Sowmy Kitchen account</p>
        <h2>Sign in</h2>
        <p>Students see only their own meals and wallet. Owner and driver workspaces are available only to their respective accounts.</p>
        <label className="staff-field">Email<input name="email" type="email" placeholder="name@sowmykitchen.com" autoComplete="email" required /></label>
        <label className="staff-field">Password<input name="password" type="password" placeholder="Enter password" autoComplete="current-password" required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="wide"><ShieldCheck size={18} /> Sign in securely</button>
        <div className="demo-credentials"><strong>Local demo only</strong><span>Student: student@sowmykitchen.test</span><span>Owner: owner@sowmykitchen.test</span><span>Driver: driver@sowmykitchen.test</span><span>Password: sowmy-demo</span></div>
      </form>
    </div>
  );
}

function MarketingSections() {
  return (
    <section className="marketing" id="plans">
      <div>
        <p className="eyebrow">Meal plans</p>
        <h2>Homemade food subscriptions for hostel students</h2>
        <p>Lunch and dinner plans support Veg and Non-Veg preferences, wallet recharges, skips, delivery status, and approved reviews for local discovery.</p>
      </div>
      <div className="plan-grid">
        {[
          ["Weekly Flexible", "Lunch or dinner with easy skips", "From ₹70"],
          ["Monthly Lunch + Dinner", "Best for hostel routines", "Wallet based"],
          ["Exam Week Support", "Simple meals and predictable timing", "Admin configurable"]
        ].map(([title, detail, price]) => (
          <article className="plan-card" key={title}>
            <CheckCircle2 size={20} />
            <h3>{title}</h3>
            <p>{detail}</p>
            <strong>{price}</strong>
          </article>
        ))}
      </div>
      <div className="reviews">
        {reviews.filter((review) => review.approved).map((review) => (
          <article key={review.id}>
            <div className="stars">{Array.from({ length: review.stars }).map((_, index) => <Star key={index} size={15} fill="currentColor" />)}</div>
            <p>{review.text}</p>
            <strong>{review.studentName}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

function StatusList(props: { holidays: Holiday[]; transactions: WalletTransaction[]; notifications: NotificationRecord[] }) {
  return (
    <div className="status-stack">
      <Row title="Environment" detail="Development mode with mock Razorpay and mock WhatsApp provider." />
      <Row title="Holidays" detail={`${props.holidays.length} published holiday records`} />
      <Row title="Ledger" detail={`${props.transactions.length} auditable wallet transactions`} />
      <Row title="Notifications" detail={`${props.notifications.length} channel events logged`} />
    </div>
  );
}

function Metric(props: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <article className="metric">
      <span>{props.icon}</span>
      <p>{props.label}</p>
      <strong>{props.value}</strong>
    </article>
  );
}

function Panel(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h3>{props.title}</h3>
      {props.children}
    </section>
  );
}

function Row(props: { title: string; detail: string }) {
  return (
    <div className="row">
      <strong>{props.title}</strong>
      <span>{props.detail}</span>
    </div>
  );
}

function PrepBar(props: { label: string; value: number; max: number }) {
  const width = `${Math.min(100, Math.round((props.value / props.max) * 100))}%`;
  return (
    <div className="prep">
      <div><span>{props.label}</span><strong>{props.value}</strong></div>
      <i><b style={{ width }} /></i>
    </div>
  );
}
