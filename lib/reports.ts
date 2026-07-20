import "server-only";
import { db } from "./db";
import { toNumber } from "./money";

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

  const [paySum, expSum, sessions, sessionTotal, students, teachers] =
    await Promise.all([
      db.payment.aggregate({
        _sum: { amount: true },
        where: dateWhere ? { date: dateWhere } : undefined,
      }),
      db.expense.aggregate({
        _sum: { amount: true },
        where: dateWhere ? { date: dateWhere } : undefined,
      }),
      db.session.count({ where: dateWhere ? { date: dateWhere } : undefined }),
      db.session.aggregate({
        _sum: { total: true },
        where: dateWhere ? { date: dateWhere } : undefined,
      }),
      db.student.count({ where: { active: true } }),
      db.teacher.count({ where: { active: true } }),
    ]);

  const income = toNumber(paySum._sum.amount);
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
  const grouped = await db.session.groupBy({
    by: ["teacherId"],
    _sum: { total: true, hours: true },
    where: dateWhere ? { date: dateWhere } : undefined,
  });
  const teachers = await db.teacher.findMany({
    where: { id: { in: grouped.map((g) => g.teacherId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(teachers.map((t) => [t.id, t.name]));
  return grouped
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
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);

  const [payments, expenses] = await Promise.all([
    db.payment.findMany({ where: { date: { gte: start } }, select: { date: true, amount: true } }),
    db.expense.findMany({ where: { date: { gte: start } }, select: { date: true, amount: true } }),
  ]);

  const buckets = new Map<string, { income: number; expenses: number }>();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1) + i, 1);
    buckets.set(d.toISOString().slice(0, 7), { income: 0, expenses: 0 });
  }
  for (const p of payments) {
    const k = p.date.toISOString().slice(0, 7);
    const b = buckets.get(k);
    if (b) b.income += toNumber(p.amount);
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
