import { describe, expect, it } from "vitest";
import { generateOrdersForDate, publishHoliday, skipFutureMeal } from "./business";
import { initialMenus, initialStudents } from "./data";

describe("Sowmy Kitchen business automation", () => {
  it("deducts wallet only when an order is confirmed", () => {
    const result = generateOrdersForDate({
      date: "2026-08-21",
      students: initialStudents,
      menus: initialMenus,
      holidays: [],
      existingOrders: [],
      lowBalanceThreshold: 200
    });

    const ananya = result.students.find((student) => student.id === "stu-001")!;
    const vikramDinner = result.orders.find((order) => order.studentId === "stu-002" && order.meal === "Dinner")!;

    expect(ananya.walletBalance).toBe(820);
    expect(vikramDinner.status).toBe("PAYMENT_REQUIRED");
    expect(result.transactions.every((transaction) => transaction.type === "MEAL_DEDUCTION")).toBe(true);
  });

  it("refunds confirmed orders and prevents production counts when a holiday is published", () => {
    const generated = generateOrdersForDate({
      date: "2026-08-21",
      students: initialStudents,
      menus: initialMenus,
      holidays: [],
      existingOrders: [],
      lowBalanceThreshold: 200
    });

    const holiday = publishHoliday({
      date: "2026-08-21",
      reason: "College Holiday",
      announcement: "No lunch or dinner service.",
      adminName: "Owner",
      orders: generated.orders,
      students: generated.students
    });

    expect(holiday.orders.filter((order) => order.status === "CONFIRMED")).toHaveLength(0);
    expect(holiday.transactions.some((transaction) => transaction.type === "CANCELLATION_REFUND")).toBe(true);
    expect(holiday.audit.action).toBe("HOLIDAY_CREATED");
  });

  it("skips a future confirmed meal, creates an auditable refund, and blocks re-generation", () => {
    const generated = generateOrdersForDate({
      date: "2026-08-21", students: initialStudents, menus: initialMenus, holidays: [], existingOrders: [], lowBalanceThreshold: 200
    });
    const student = generated.students.find((record) => record.id === "stu-001")!;
    const skipped = skipFutureMeal({ student, date: "2026-08-21", meal: "Lunch", orders: generated.orders, currentDate: "2026-08-20" });

    expect(skipped.orders.find((order) => order.studentId === student.id && order.meal === "Lunch")?.status).toBe("SKIPPED");
    expect(skipped.transactions[0]?.type).toBe("REFUND");
    const rerun = generateOrdersForDate({ date: "2026-08-21", students: [skipped.student], menus: initialMenus, holidays: [], existingOrders: skipped.orders, skips: [skipped.skip], lowBalanceThreshold: 200 });
    expect(rerun.orders.filter((order) => order.studentId === student.id && order.meal === "Lunch")).toHaveLength(1);
  });
});
