import "server-only";
import { db } from "./db";
import { toNumber } from "./money";
import { unchargeableStatuses } from "./billing";

/**
 * What each role needs to see first thing in the morning.
 *
 * One reader per dashboard rather than one wide reader everybody filters,
 * because the filtering IS the permission. A receptionist's page cannot leak
 * the centre's profit if the query that would have fetched it was never run —
 * hiding a number client-side still ships it to the browser.
 */

const dayBounds = (d = new Date()) => {
  const iso = d.toISOString().slice(0, 10);
  const start = new Date(`${iso}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end, iso };
};

const monthStart = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
};

/* ------------------------------------------------------------ reception --- */

/** The desk's day: who is expected, who arrived, what still needs chasing. */
export async function receptionToday() {
  const { start, end } = dayBounds();
  // The counts below are counts of lessons, so they drop only unconfirmed
  // drafts. The last query is about money and must use the shared rule.
  const unchargeable = await unchargeableStatuses();
  const [today, checkedIn, completed, noShow, newLeads, unpaidStudents] =
    await Promise.all([
      db.session.count({ where: { date: { gte: start, lt: end }, status: { not: "DRAFT" } } }),
      db.session.count({ where: { date: { gte: start, lt: end }, status: "CHECKED_IN" } }),
      db.session.count({ where: { date: { gte: start, lt: end }, status: "COMPLETED" } }),
      db.session.count({ where: { date: { gte: start, lt: end }, status: "NO_SHOW" } }),
      db.lead.count({ where: { status: "NEW" } }),
      db.session.findMany({
        // Was DRAFT and CANCELLED only, so an unbilled no-show counted as a
        // family who owes money — the desk chased people for nothing.
        where: { paymentStatus: { not: "PAID" }, status: { notIn: unchargeable } },
        select: { studentId: true },
        distinct: ["studentId"],
      }),
    ]);
  const settled = completed + noShow;
  return {
    today,
    checkedIn,
    completed,
    noShow,
    pending: Math.max(0, today - settled - checkedIn),
    newLeads,
    familiesOwing: unpaidStudents.length,
  };
}

/* -------------------------------------------------------------- cashier --- */

/** Money coming in. Never money going out — that is not this desk's job. */
export async function cashierToday() {
  const { start, end } = dayBounds();
  const [todaySum, monthSum, todayCount, owing] = await Promise.all([
    db.payment.aggregate({ _sum: { amount: true }, where: { date: { gte: start, lt: end } } }),
    db.payment.aggregate({ _sum: { amount: true }, where: { date: { gte: monthStart() } } }),
    db.payment.count({ where: { date: { gte: start, lt: end } } }),
    db.session.findMany({
      where: {
        paymentStatus: { not: "PAID" },
        packageId: null,
        status: { notIn: await unchargeableStatuses() },
      },
      select: { studentId: true, total: true },
    }),
  ]);
  const outstanding = owing.reduce((a, s) => a + toNumber(s.total), 0);
  return {
    collectedToday: toNumber(todaySum._sum.amount),
    collectedMonth: toNumber(monthSum._sum.amount),
    receiptsToday: todayCount,
    outstanding,
    familiesOwing: new Set(owing.map((s) => s.studentId)).size,
  };
}

/* ------------------------------------------------------------- academic --- */

/** Teaching, with no money anywhere in the query. */
export async function academicToday() {
  const { start, end } = dayBounds();
  const weekEnd = new Date(start);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  const [today, week, completed, noShow, teachers, unassigned] = await Promise.all([
    db.session.count({ where: { date: { gte: start, lt: end }, status: { not: "DRAFT" } } }),
    db.session.count({ where: { date: { gte: start, lt: weekEnd }, status: { not: "DRAFT" } } }),
    db.session.count({ where: { date: { gte: start, lt: weekEnd }, status: "COMPLETED" } }),
    db.session.count({ where: { date: { gte: start, lt: weekEnd }, status: "NO_SHOW" } }),
    db.teacher.count({ where: { active: true } }),
    db.session.count({
      where: { date: { gte: start, lt: weekEnd }, teacherId: null, status: { not: "DRAFT" } },
    }),
  ]);
  const settled = completed + noShow;
  return {
    today,
    week,
    attendanceRate: settled ? Math.round((completed / settled) * 100) : null,
    activeTeachers: teachers,
    unassigned,
    absencesWeek: noShow,
  };
}

/* ------------------------------------------------------------ transport --- */

/** The fleet's day. Passenger names live inside a trip; the register does not. */
export async function transportToday() {
  const { start, end } = dayBounds();
  const [trips, blocked, undriven, vehicles, drivers, km] = await Promise.all([
    db.trip.count({ where: { date: { gte: start, lt: end } } }),
    db.trip.count({
      where: { date: { gte: start, lt: end }, validationStatus: "INVALID" },
    }),
    db.trip.count({ where: { date: { gte: start, lt: end }, driverId: null } }),
    db.vehicle.count({ where: { active: true } }),
    db.driver.count(),
    db.trip.aggregate({ _sum: { estimatedKm: true }, where: { date: { gte: start, lt: end } } }),
  ]);
  return {
    trips,
    blocked,
    undriven,
    vehicles,
    drivers,
    km: Math.round(toNumber(km._sum.estimatedKm) * 10) / 10,
  };
}

/* ------------------------------------------------------------------ HR --- */

/** People and their paperwork. Staff pay, never centre profit. */
export async function hrOverview() {
  const now = new Date();
  const in30 = new Date(now);
  in30.setUTCDate(in30.getUTCDate() + 30);
  const [headcount, onLeave, expiring, expired, pendingLeave, lastRun] = await Promise.all([
    db.employee.count({ where: { status: "ACTIVE" } }),
    db.employee.count({ where: { status: "ON_LEAVE" } }),
    db.employeeDocument.count({ where: { expiresOn: { gte: now, lte: in30 } } }),
    db.employeeDocument.count({ where: { expiresOn: { lt: now } } }),
    db.leaveRequest.count({ where: { status: "PENDING" } }),
    db.payrollRun.findFirst({ orderBy: { createdAt: "desc" }, select: { status: true } }),
  ]);
  return {
    headcount,
    onLeave,
    expiring,
    expired,
    pendingLeave,
    lastRunStatus: lastRun?.status ?? null,
  };
}
