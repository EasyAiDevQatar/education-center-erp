import "server-only";
import { db } from "./db";
import { toNumber } from "./money";
import {
  computePay,
  resolveEarningsMode,
  type EarningsMode,
} from "./earnings-mode";

export type TeacherEarnings = {
  teacherId: string;
  name: string;
  commissionPct: number;
  hours: number;
  /** Sum of session totals delivered in the period (billed, may be unpaid). */
  expected: number;
  /** Sum of payments collected and allocated to the teacher in the period. */
  collected: number;
  /** commissionPct applied to `expected` — what the sessions will earn once collected. */
  expectedCommission: number;
  /** commissionPct applied to `collected` — what is actually payable now. */
  dueCommission: number;
  fixedSalary: number;
  fixedDeductions: number;
  /** What this teacher is actually owed under their earnings mode, before
      ad-hoc advances. Suppressed components are zero, not missing. */
  netPayable: number;
  paymentMode: string | null;
  /** Resolved SALARY | COMMISSION | BOTH — the teacher's own or the centre's. */
  earningsMode: EarningsMode;
};

/**
 * The centre-wide default earnings mode.
 *
 * Read once per query rather than per teacher: it is a single settings row and
 * every teacher without an explicit mode resolves against it.
 */
async function centreEarningsMode(): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key: "teacherEarningsMode" } });
  return row?.value ?? null;
}

function rangeWhere(from?: Date, to?: Date) {
  if (!from && !to) return undefined;
  const f: { gte?: Date; lte?: Date } = {};
  if (from) f.gte = from;
  if (to) f.lte = to;
  return f;
}

function build(
  t: {
    id: string;
    name: string;
    commissionPct: unknown;
    fixedSalary: unknown;
    fixedDeductions: unknown;
    paymentMode: string | null;
    earningsMode: string | null;
  },
  expected: number,
  collected: number,
  hours: number,
  centreDefault: string | null,
): TeacherEarnings {
  const pct = toNumber(t.commissionPct as never);
  const fixedSalary = toNumber(t.fixedSalary as never);
  const fixedDeductions = toNumber(t.fixedDeductions as never);
  const expectedCommission = (expected * pct) / 100;
  const dueCommission = (collected * pct) / 100;
  const mode = resolveEarningsMode(t.earningsMode, centreDefault);
  const pay = computePay(mode, {
    commission: dueCommission,
    salary: fixedSalary,
    deductions: fixedDeductions,
  });
  return {
    teacherId: t.id,
    name: t.name,
    commissionPct: pct,
    hours,
    expected,
    collected,
    expectedCommission,
    dueCommission,
    fixedSalary,
    fixedDeductions,
    netPayable: pay.net,
    paymentMode: t.paymentMode,
    earningsMode: mode,
  };
}

/** Earnings & commission for all active teachers over an optional date range. */
export async function getAllTeacherEarnings(
  from?: Date,
  to?: Date,
): Promise<TeacherEarnings[]> {
  const dateRange = rangeWhere(from, to);
  const [teachers, centreDefault] = await Promise.all([
    db.teacher.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    centreEarningsMode(),
  ]);

  const [sessionsGrouped, paymentsGrouped] = await Promise.all([
    db.session.groupBy({
      by: ["teacherId"],
      _sum: { total: true, hours: true },
      // Planner drafts are unconfirmed — never earn commission.
      where: { status: { not: "DRAFT" }, ...(dateRange ? { date: dateRange } : {}) },
    }),
    db.payment.groupBy({
      by: ["teacherId"],
      _sum: { amount: true },
      where: dateRange ? { date: dateRange } : undefined,
    }),
  ]);

  const sMap = new Map(sessionsGrouped.map((g) => [g.teacherId, g._sum]));
  const pMap = new Map(paymentsGrouped.map((g) => [g.teacherId, g._sum]));

  return teachers.map((t) =>
    build(
      t,
      toNumber(sMap.get(t.id)?.total),
      toNumber(pMap.get(t.id)?.amount),
      toNumber(sMap.get(t.id)?.hours),
      centreDefault,
    ),
  );
}

/** Earnings for one teacher over a range (used when generating a payslip). */
export async function getTeacherEarnings(
  teacherId: string,
  from: Date,
  to: Date,
): Promise<TeacherEarnings | null> {
  const [teacher, centreDefault] = await Promise.all([
    db.teacher.findUnique({ where: { id: teacherId } }),
    centreEarningsMode(),
  ]);
  if (!teacher) return null;
  const dateRange = rangeWhere(from, to);
  const [s, p] = await Promise.all([
    db.session.aggregate({
      _sum: { total: true, hours: true },
      where: { teacherId, date: dateRange, status: { not: "DRAFT" } },
    }),
    db.payment.aggregate({
      _sum: { amount: true },
      where: { teacherId, date: dateRange },
    }),
  ]);
  return build(
    teacher,
    toNumber(s._sum.total),
    toNumber(p._sum.amount),
    toNumber(s._sum.hours),
    centreDefault,
  );
}
