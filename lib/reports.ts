import "server-only";
import { db } from "./db";
import { toNumber } from "./money";
import { unchargeableStatuses } from "./billing";
import { getPaymentCashFlow } from "./payment-report-queries";
import { centerToday } from "./session-time";
import { NON_OPERATIONAL_SESSION_STATUSES } from "./enums";

export type DateRange = { from?: Date; to?: Date };

function dateFilter(range?: DateRange) {
  if (!range?.from && !range?.to) return undefined;
  return {
    gte: range?.from ?? undefined,
    lte: range?.to ?? undefined,
  };
}

/** Headline KPIs for the dashboard (mirrors the Excel `اجماليات` sheet). */
export async function getDashboardSummary(range?: DateRange) {
  const dateWhere = dateFilter(range);
  const unchargeable = await unchargeableStatuses();

  const [paySum, expSum, sessions, sessionTotal, students, teachers] =
    await Promise.all([
      getPaymentCashFlow(range),
      db.expense.aggregate({
        _sum: { amount: true },
        where: dateWhere ? { date: dateWhere } : undefined,
      }),
      // Drafts are unconfirmed plans and cancellations never ran, so neither
      // can inflate the operational session total.
      db.session.count({
        where: { status: { notIn: [...NON_OPERATIONAL_SESSION_STATUSES] }, ...(dateWhere ? { date: dateWhere } : {}) },
      }),
      db.session.aggregate({
        _sum: { total: true },
        where: { status: { notIn: unchargeable }, ...(dateWhere ? { date: dateWhere } : {}) },
      }),
      db.student.count({ where: { active: true } }),
      db.teacher.count({ where: { active: true } }),
    ]);

  const income = paySum.totals.net;
  const expenses = toNumber(expSum._sum.amount);
  const expectedIncome = toNumber(sessionTotal._sum.total);

  return {
    income,
    expenses,
    net: income - expenses,
    expectedIncome,
    outstanding: expectedIncome - income,
    sessionsCount: sessions,
    studentsCount: students,
    activeTeachers: teachers,
  };
}

/** Revenue (expected) grouped by teacher — mirrors the `معلمين` pivot. */
export async function getRevenueByTeacher(range?: DateRange) {
  const dateWhere = dateFilter(range);
  const unchargeable = await unchargeableStatuses();
  const grouped = await db.session.groupBy({
    by: ["teacherId"],
    _sum: { total: true, hours: true },
    where: { status: { notIn: unchargeable }, ...(dateWhere ? { date: dateWhere } : {}) },
  });
  // Sessions still awaiting a teacher have nothing to attribute revenue to.
  const assigned = grouped.filter(
    (g): g is typeof g & { teacherId: string } => g.teacherId !== null,
  );
  const teachers = await db.teacher.findMany({
    where: { id: { in: assigned.map((g) => g.teacherId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(teachers.map((t) => [t.id, t.name]));
  return assigned
    .map((g) => ({
      teacherId: g.teacherId,
      name: nameById.get(g.teacherId) ?? "—",
      total: toNumber(g._sum.total),
      hours: toNumber(g._sum.hours),
    }))
    .sort((a, b) => b.total - a.total);
}

/** Income vs expenses per calendar month for the last `months` months. */
export async function getMonthlyTrend(months = 12) {
  const today = centerToday();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const start = new Date(Date.UTC(year, month - (months - 1), 1));
  const end = new Date(`${today}T23:59:59.999Z`);

  const [cashFlow, expenses] = await Promise.all([
    getPaymentCashFlow({ from: start, to: end }),
    db.expense.findMany({
      where: { date: { gte: start, lte: end } },
      select: { date: true, amount: true },
    }),
  ]);

  const buckets = new Map<string, { income: number; expenses: number }>();
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(year, month - (months - 1) + i, 1));
    buckets.set(d.toISOString().slice(0, 7), { income: 0, expenses: 0 });
  }
  for (const movement of cashFlow.monthly) {
    const bucket = buckets.get(movement.month);
    if (bucket) bucket.income = movement.net;
  }
  for (const e of expenses) {
    const k = e.date.toISOString().slice(0, 7);
    const b = buckets.get(k);
    if (b) b.expenses += toNumber(e.amount);
  }
  return Array.from(buckets.entries()).map(([month, v]) => ({
    month,
    income: v.income,
    expenses: v.expenses,
    net: v.income - v.expenses,
  }));
}

/** Expenses grouped by category — mirrors the `المصروفات` category columns. */
export async function getExpensesByCategory(range?: DateRange) {
  const dateWhere = dateFilter(range);
  const grouped = await db.expense.groupBy({
    by: ["categoryId"],
    _sum: { amount: true },
    where: dateWhere ? { date: dateWhere } : undefined,
  });
  const cats = await db.expenseCategory.findMany({
    where: { id: { in: grouped.map((g) => g.categoryId) } },
  });
  const byId = new Map(cats.map((c) => [c.id, c]));
  return grouped
    .map((g) => ({
      categoryId: g.categoryId,
      nameAr: byId.get(g.categoryId)?.nameAr ?? "—",
      nameEn: byId.get(g.categoryId)?.nameEn ?? "—",
      total: toNumber(g._sum.amount),
    }))
    .sort((a, b) => b.total - a.total);
}
