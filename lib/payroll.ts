import "server-only";
import { db } from "./db";
import { toNumber } from "./money";

export type TeacherEarnings = {
  teacherId: string;
  name: string;
  commissionPct: number;
  hours: number;
  expected: number; // sum of session totals delivered
  collected: number; // sum of payments allocated to the teacher
  commission: number; // expected * pct/100
};

function rangeWhere(from?: Date, to?: Date) {
  if (!from && !to) return undefined;
  const f: { gte?: Date; lte?: Date } = {};
  if (from) f.gte = from;
  if (to) f.lte = to;
  return f;
}

/** Earnings & commission for all active teachers over an optional date range. */
export async function getAllTeacherEarnings(
  from?: Date,
  to?: Date,
): Promise<TeacherEarnings[]> {
  const dateRange = rangeWhere(from, to);
  const teachers = await db.teacher.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });

  const [sessionsGrouped, paymentsGrouped] = await Promise.all([
    db.session.groupBy({
      by: ["teacherId"],
      _sum: { total: true, hours: true },
      where: dateRange ? { date: dateRange } : undefined,
    }),
    db.payment.groupBy({
      by: ["teacherId"],
      _sum: { amount: true },
      where: dateRange ? { date: dateRange } : undefined,
    }),
  ]);

  const sMap = new Map(sessionsGrouped.map((g) => [g.teacherId, g._sum]));
  const pMap = new Map(paymentsGrouped.map((g) => [g.teacherId, g._sum]));

  return teachers.map((t) => {
    const pct = toNumber(t.commissionPct);
    const expected = toNumber(sMap.get(t.id)?.total);
    const hours = toNumber(sMap.get(t.id)?.hours);
    const collected = toNumber(pMap.get(t.id)?.amount);
    return {
      teacherId: t.id,
      name: t.name,
      commissionPct: pct,
      hours,
      expected,
      collected,
      commission: (expected * pct) / 100,
    };
  });
}

/** Earnings for one teacher over a range (used when generating a payslip). */
export async function getTeacherEarnings(
  teacherId: string,
  from: Date,
  to: Date,
): Promise<TeacherEarnings | null> {
  const teacher = await db.teacher.findUnique({ where: { id: teacherId } });
  if (!teacher) return null;
  const dateRange = rangeWhere(from, to);
  const [s, p] = await Promise.all([
    db.session.aggregate({
      _sum: { total: true, hours: true },
      where: { teacherId, date: dateRange },
    }),
    db.payment.aggregate({
      _sum: { amount: true },
      where: { teacherId, date: dateRange },
    }),
  ]);
  const pct = toNumber(teacher.commissionPct);
  const expected = toNumber(s._sum.total);
  return {
    teacherId,
    name: teacher.name,
    commissionPct: pct,
    hours: toNumber(s._sum.hours),
    expected,
    collected: toNumber(p._sum.amount),
    commission: (expected * pct) / 100,
  };
}
