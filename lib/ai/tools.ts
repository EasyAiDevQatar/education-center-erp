import "server-only";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { displayName, nameSearchText } from "@/lib/names";
import { getStudentBalance } from "@/lib/balances";

/**
 * The assistant's tool belt: curated, read-only queries over centre data.
 *
 * The model NEVER writes SQL and never mutates anything — each tool is a thin
 * wrapper over the same query logic the pages use, so the assistant can only
 * see what staff screens already show. Results are compact JSON built for a
 * model to read, not UI payloads.
 */

export type AiTool = {
  name: string;
  description: string;
  /** Human-ish parameter spec shown to the model. */
  params: string;
  execute: (args: Record<string, unknown>, locale: string) => Promise<unknown>;
};

const PERIODS = ["today", "week", "month", "year"] as const;
type Period = (typeof PERIODS)[number];

function periodRange(period: string): { gte: Date; lt: Date } {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end);
  const p = (PERIODS as readonly string[]).includes(period) ? (period as Period) : "month";
  if (p === "today") start.setUTCDate(start.getUTCDate() - 1);
  else if (p === "week") start.setUTCDate(start.getUTCDate() - 7);
  else if (p === "month") start.setUTCMonth(start.getUTCMonth() - 1);
  else start.setUTCFullYear(start.getUTCFullYear() - 1);
  return { gte: start, lt: end };
}

function dayRange(dateIso: string): { gte: Date; lt: Date } {
  const start = new Date(`${dateIso}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { gte: start, lt: end };
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export const AI_TOOLS: AiTool[] = [
  {
    name: "revenueSummary",
    description: "Totals for a period: session revenue (excl. drafts/cancelled), payments received, expenses.",
    params: '{"period": "today" | "week" | "month" | "year"}',
    async execute(args) {
      const range = periodRange(str(args.period, "month"));
      const [sessions, payments, expenses] = await Promise.all([
        db.session.aggregate({
          _sum: { total: true },
          _count: true,
          where: { date: range, status: { notIn: ["DRAFT", "CANCELLED"] } },
        }),
        db.payment.aggregate({ _sum: { amount: true }, _count: true, where: { date: range } }),
        db.expense.aggregate({ _sum: { amount: true }, _count: true, where: { date: range } }),
      ]);
      return {
        period: str(args.period, "month"),
        sessionRevenue: toNumber(sessions._sum.total),
        sessionCount: sessions._count,
        paymentsReceived: toNumber(payments._sum.amount),
        paymentCount: payments._count,
        expensesTotal: toNumber(expenses._sum.amount),
        expenseCount: expenses._count,
      };
    },
  },
  {
    name: "outstandingBalances",
    description: "Students who owe the most (charges minus payments), highest first.",
    params: '{"limit": number (default 10, max 25)}',
    async execute(args, locale) {
      const limit = Math.min(Math.max(1, num(args.limit, 10)), 25);
      const [charges, packages, paid, students] = await Promise.all([
        db.session.groupBy({
          by: ["studentId"],
          _sum: { total: true },
          where: { status: { not: "DRAFT" }, packageId: null },
        }),
        db.package.groupBy({ by: ["studentId"], _sum: { price: true } }),
        db.payment.groupBy({ by: ["studentId"], _sum: { amount: true }, where: { studentId: { not: null } } }),
        db.student.findMany({ select: { id: true, name: true, nameEn: true } }),
      ]);
      const nameOf = new Map(students.map((s) => [s.id, displayName(s, locale)]));
      const owes = new Map<string, number>();
      for (const c of charges) owes.set(c.studentId, (owes.get(c.studentId) ?? 0) + toNumber(c._sum.total));
      for (const p of packages) owes.set(p.studentId, (owes.get(p.studentId) ?? 0) + toNumber(p._sum.price));
      for (const p of paid) {
        if (p.studentId) owes.set(p.studentId, (owes.get(p.studentId) ?? 0) - toNumber(p._sum.amount));
      }
      return [...owes.entries()]
        .filter(([, v]) => v > 0.005)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([id, balance]) => ({ student: nameOf.get(id) ?? id, owes: Math.round(balance * 100) / 100 }));
    },
  },
  {
    name: "studentSearch",
    description: "Find students by (partial) name or phone. Returns id, name, grade, phone.",
    params: '{"q": "search text"}',
    async execute(args, locale) {
      const q = str(args.q).trim().toLowerCase();
      if (!q) return [];
      const students = await db.student.findMany({
        where: { active: true },
        include: { gradeLevel: true },
      });
      return students
        .filter((s) => nameSearchText(s).toLowerCase().includes(q) || (s.phone ?? "").includes(q))
        .slice(0, 10)
        .map((s) => ({
          id: s.id,
          name: displayName(s, locale),
          gradeYear: s.gradeYear,
          grade: locale === "ar" ? s.gradeLevel?.nameAr : s.gradeLevel?.nameEn,
          phone: s.phone,
        }));
    },
  },
  {
    name: "studentBalance",
    description: "One student's account: total charges, total paid, balance owed. Use studentSearch first to get the id.",
    params: '{"studentId": "id from studentSearch"}',
    async execute(args) {
      const id = str(args.studentId);
      if (!id) return { error: "studentId required" };
      const student = await db.student.findUnique({ where: { id }, select: { name: true, nameEn: true } });
      if (!student) return { error: "not found" };
      const b = await getStudentBalance(id);
      return { student: student.name, ...b };
    },
  },
  {
    name: "teacherSummary",
    description: "A teacher's activity for a period: sessions, hours, revenue they generated.",
    params: '{"q": "teacher name", "period": "week" | "month" | "year"}',
    async execute(args, locale) {
      const q = str(args.q).trim().toLowerCase();
      const range = periodRange(str(args.period, "month"));
      const teachers = await db.teacher.findMany({ where: { active: true } });
      const teacher = teachers.find((t) => nameSearchText(t).toLowerCase().includes(q));
      if (!teacher) return { error: "teacher not found", knownTeachers: teachers.slice(0, 15).map((t) => displayName(t, locale)) };
      const agg = await db.session.aggregate({
        _sum: { total: true, hours: true },
        _count: true,
        where: { teacherId: teacher.id, date: range, status: { notIn: ["DRAFT", "CANCELLED"] } },
      });
      return {
        teacher: displayName(teacher, locale),
        period: str(args.period, "month"),
        sessions: agg._count,
        hours: toNumber(agg._sum.hours),
        revenue: toNumber(agg._sum.total),
        commissionPct: toNumber(teacher.commissionPct),
      };
    },
  },
  {
    name: "sessionsOn",
    description: "The schedule for one day: every session with time, student, teacher, place and status.",
    params: '{"date": "YYYY-MM-DD"}',
    async execute(args, locale) {
      const date = str(args.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "date must be YYYY-MM-DD" };
      const sessions = await db.session.findMany({
        where: { date: dayRange(date) },
        include: { student: true, teacher: true },
        orderBy: { date: "asc" },
      });
      return sessions.slice(0, 60).map((s) => ({
        time: s.date.toISOString().slice(11, 16),
        student: displayName(s.student, locale),
        teacher: s.teacher ? displayName(s.teacher, locale) : null,
        location: s.location,
        status: s.status,
        hours: toNumber(s.hours),
        total: toNumber(s.total),
      }));
    },
  },
  {
    name: "expenseSummary",
    description: "Expenses for a period, grouped by category.",
    params: '{"period": "week" | "month" | "year"}',
    async execute(args, locale) {
      const range = periodRange(str(args.period, "month"));
      const rows = await db.expense.findMany({ where: { date: range }, include: { category: true } });
      const byCat = new Map<string, number>();
      for (const e of rows) {
        const label = e.category
          ? locale === "ar"
            ? e.category.nameAr
            : e.category.nameEn
          : "—";
        byCat.set(label, (byCat.get(label) ?? 0) + toNumber(e.amount));
      }
      return {
        total: rows.reduce((a, e) => a + toNumber(e.amount), 0),
        byCategory: [...byCat.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total),
      };
    },
  },
  {
    name: "transportDaySummary",
    description: "Transport plan for a day: how many rides are proposed/assigned, and which legs could not be assigned (with reasons).",
    params: '{"date": "YYYY-MM-DD"}',
    async execute(args, locale) {
      const date = str(args.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "date must be YYYY-MM-DD" };
      // Lazy import: the transport module may be flagged off.
      const { buildDayPlan } = await import("@/lib/transport/trip-data");
      const plan = await buildDayPlan(locale, date);
      const legName = new Map(plan.legs.map((l) => [l.id, `${l.passengerName}: ${l.fromLabel} -> ${l.toLabel}`]));
      return {
        date,
        legs: plan.legs.length,
        assigned: plan.assignments.length,
        unassigned: plan.unassigned.map((u) => ({ leg: legName.get(u.legId) ?? u.legId, reason: u.reason })),
        skippedNoCoordinates: plan.skipped.map((s) => s.passengerName),
        drivers: plan.drivers.map((d) => d.name),
        centreSet: plan.centreSet,
      };
    },
  },
];

export function toolCatalog(): string {
  return AI_TOOLS.map((t) => `- ${t.name}: ${t.description} Args: ${t.params}`).join("\n");
}

export function getTool(name: string): AiTool | undefined {
  return AI_TOOLS.find((t) => t.name === name);
}
