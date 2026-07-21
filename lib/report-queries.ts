import "server-only";
import { db } from "./db";
import { toNumber } from "./money";
import { getStudentBalance } from "./balances";
import type { DateRange } from "./reports";

/** Sessions that never happened still count as attendance outcomes. */
const ATTENDANCE_STATUSES = ["COMPLETED", "NO_SHOW", "CANCELLED", "CHECKED_IN", "SCHEDULED"];

function dateWhere(range?: DateRange) {
  if (!range?.from && !range?.to) return undefined;
  return { gte: range?.from ?? undefined, lte: range?.to ?? undefined };
}

/** Base filter shared by every report: drafts are plans, not facts. */
function baseWhere(range?: DateRange) {
  const d = dateWhere(range);
  return { status: { not: "DRAFT" }, ...(d ? { date: d } : {}) };
}

export type AttendanceRow = {
  id: string;
  name: string;
  total: number;
  completed: number;
  noShow: number;
  cancelled: number;
  hours: number;
  /** Completed ÷ (completed + no-show), i.e. of the lessons that were meant to run. */
  attendanceRate: number;
};

/**
 * Attendance broken down by teacher or by student.
 *
 * The rate deliberately excludes cancellations: a lesson called off in advance
 * is an admin event, not a student failing to turn up, so counting it would
 * make a well-run week look like a bad one.
 */
export async function getAttendance(
  by: "teacher" | "student",
  range?: DateRange,
): Promise<AttendanceRow[]> {
  const sessions = await db.session.findMany({
    where: { ...baseWhere(range), status: { in: ATTENDANCE_STATUSES } },
    select: {
      status: true,
      hours: true,
      teacherId: true,
      studentId: true,
      teacher: { select: { name: true } },
      student: { select: { name: true } },
    },
  });

  const map = new Map<string, AttendanceRow>();
  for (const s of sessions) {
    // Grouping by teacher skips sessions still awaiting one: counting them
    // under a fake bucket would distort every teacher's attendance rate.
    if (by === "teacher" && !s.teacherId) continue;
    const id = by === "teacher" ? s.teacherId! : s.studentId;
    const name = by === "teacher" ? (s.teacher?.name ?? "") : s.student.name;
    let row = map.get(id);
    if (!row) {
      row = { id, name, total: 0, completed: 0, noShow: 0, cancelled: 0, hours: 0, attendanceRate: 0 };
      map.set(id, row);
    }
    row.total++;
    if (s.status === "COMPLETED") {
      row.completed++;
      row.hours += toNumber(s.hours);
    } else if (s.status === "NO_SHOW") row.noShow++;
    else if (s.status === "CANCELLED") row.cancelled++;
  }

  return [...map.values()]
    .map((r) => ({
      ...r,
      attendanceRate:
        r.completed + r.noShow > 0
          ? Math.round((r.completed / (r.completed + r.noShow)) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

export type RevenueRow = {
  key: string;
  label: string;
  sessions: number;
  hours: number;
  expected: number;
};

/** Expected revenue grouped by teacher, grade level or location. */
export async function getRevenueBreakdown(
  by: "teacher" | "level" | "location",
  range: DateRange | undefined,
  locale: string,
): Promise<RevenueRow[]> {
  const sessions = await db.session.findMany({
    where: baseWhere(range),
    select: {
      hours: true,
      total: true,
      location: true,
      teacherId: true,
      gradeLevelId: true,
      teacher: { select: { name: true } },
      gradeLevel: { select: { nameAr: true, nameEn: true } },
    },
  });

  const map = new Map<string, RevenueRow>();
  for (const s of sessions) {
    let key: string;
    let label: string;
    if (by === "teacher") {
      // Same reasoning as the attendance report: revenue can't be attributed
      // to a teacher who hasn't been assigned yet.
      if (!s.teacherId) continue;
      key = s.teacherId;
      label = s.teacher?.name ?? "";
    } else if (by === "level") {
      key = s.gradeLevelId;
      label = locale === "ar" ? s.gradeLevel.nameAr : s.gradeLevel.nameEn;
    } else {
      key = s.location;
      label = s.location;
    }
    let row = map.get(key);
    if (!row) {
      row = { key, label, sessions: 0, hours: 0, expected: 0 };
      map.set(key, row);
    }
    row.sessions++;
    row.hours += toNumber(s.hours);
    row.expected += toNumber(s.total);
  }
  return [...map.values()].sort((a, b) => b.expected - a.expected);
}

export type PackageReportRow = {
  id: string;
  studentName: string;
  totalHours: number;
  hoursUsed: number;
  remaining: number;
  price: number;
  status: string;
  expiresAt: string | null;
};

/** Package consumption and expiry, newest first. */
export async function getPackageReport(range?: DateRange): Promise<PackageReportRow[]> {
  const d = dateWhere(range);
  const packages = await db.package.findMany({
    where: d ? { purchasedAt: d } : undefined,
    include: { student: { select: { name: true } } },
    orderBy: { purchasedAt: "desc" },
  });
  return packages.map((p) => {
    const total = toNumber(p.totalHours);
    const used = toNumber(p.hoursUsed);
    return {
      id: p.id,
      studentName: p.student.name,
      totalHours: total,
      hoursUsed: used,
      remaining: total - used,
      price: toNumber(p.price),
      status: p.status,
      expiresAt: p.expiresAt ? p.expiresAt.toISOString().slice(0, 10) : null,
    };
  });
}

export type PayoutSummaryRow = {
  id: string;
  teacherName: string;
  payMode: string | null;
  periodStart: string;
  periodEnd: string;
  grossCommission: number;
  fixedSalary: number;
  deductions: number;
  advances: number;
  netPaid: number;
  status: string;
};

/** Payouts issued in the period. */
export async function getPayoutSummary(range?: DateRange): Promise<PayoutSummaryRow[]> {
  const d = dateWhere(range);
  const payouts = await db.teacherPayout.findMany({
    where: d ? { createdAt: d } : undefined,
    include: {
      teacher: { select: { name: true } },
      employee: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return payouts.map((p) => ({
    id: p.id,
    teacherName: p.teacher?.name ?? p.employee?.name ?? "—",
    payMode: p.payMode,
    periodStart: p.periodStart.toISOString().slice(0, 10),
    periodEnd: p.periodEnd.toISOString().slice(0, 10),
    grossCommission: toNumber(p.grossCommission),
    fixedSalary: toNumber(p.fixedSalary),
    deductions: toNumber(p.deductions),
    advances: toNumber(p.advances),
    netPaid: toNumber(p.netPaid),
    status: p.status,
  }));
}

export type DebtorRow = {
  id: string;
  name: string;
  phone: string | null;
  guardianName: string | null;
  charges: number;
  paid: number;
  balance: number;
};

/**
 * Students who owe money, largest debt first.
 *
 * Balances come from `lib/balances.ts` so package-covered sessions stay
 * excluded from charges — a report that double-charged them would contradict
 * the student's own statement.
 */
export async function getTopDebtors(limit = 100): Promise<DebtorRow[]> {
  const students = await db.student.findMany({
    where: { active: true },
    select: { id: true, name: true, phone: true, guardian: { select: { name: true } } },
  });

  const balances = await Promise.all(students.map((s) => getStudentBalance(s.id)));

  const rows: DebtorRow[] = [];
  students.forEach((s, i) => {
    const bal = balances[i];
    if (bal.balance <= 0) return;
    rows.push({
      id: s.id,
      name: s.name,
      phone: s.phone,
      guardianName: s.guardian?.name ?? null,
      charges: bal.totalCharges,
      paid: bal.totalPaid,
      balance: bal.balance,
    });
  });
  return rows.sort((a, b) => b.balance - a.balance).slice(0, limit);
}

/* ---------------- dashboard alert widgets ---------------- */

/** Small, actionable lists for the dashboard: what needs attention today. */
export async function getDashboardAlerts(locale: string) {
  const today = new Date().toISOString().slice(0, 10);
  const dayStart = new Date(`${today}T00:00:00.000Z`);
  const dayEnd = new Date(`${today}T23:59:59.999Z`);
  const in14Days = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const [todaysSessions, unconfirmedDrafts, expiringPackages, debtors] = await Promise.all([
    db.session.count({
      where: { date: { gte: dayStart, lte: dayEnd }, status: { not: "DRAFT" } },
    }),
    db.session.count({ where: { date: { gte: dayStart, lte: dayEnd }, status: "DRAFT" } }),
    db.package.findMany({
      where: { status: "ACTIVE", expiresAt: { not: null, lte: in14Days } },
      include: { student: { select: { name: true } } },
      orderBy: { expiresAt: "asc" },
      take: 5,
    }),
    getTopDebtors(5),
  ]);

  return {
    todaysSessions,
    unconfirmedDrafts,
    expiringPackages: expiringPackages.map((p) => ({
      id: p.id,
      studentName: p.student.name,
      remaining: toNumber(p.totalHours) - toNumber(p.hoursUsed),
      expiresAt: p.expiresAt ? p.expiresAt.toISOString().slice(0, 10) : null,
    })),
    debtors,
    locale,
  };
}
