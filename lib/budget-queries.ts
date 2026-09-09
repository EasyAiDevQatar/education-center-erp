import "server-only";

import {
  buildBudgetReport,
  isForecastableSession,
  type BudgetMonthInput,
  type BudgetReport,
} from "./budget";
import { unchargeableStatuses } from "./billing";
import { db } from "./db";
import { toNumber } from "./money";
import { getPaymentCashFlow } from "./payment-report-queries";
import { centerToday } from "./session-time";

export type BudgetExpenseCategoryData = {
  id: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
  active: boolean;
};

export type BudgetPlanItemData = {
  id: string;
  month: string;
  kind: string;
  expenseCategoryId: string | null;
  expenseCategory: BudgetExpenseCategoryData | null;
  label: string | null;
  amount: number;
  behavior: string;
  notes: string | null;
};

export type BudgetPlanData = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  includePayrollActual: boolean;
  notes: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Source figures kept beside the calculated report so the UI can explain what
 * makes up each total. Session counts are per-student bookings: the child rows
 * of a group occurrence are deliberately not collapsed for financial planning.
 */
export type BudgetMonthActuals = {
  month: string;
  forecastSessions: number;
  forecastTuition: number;
  billableSessions: number;
  earnedTuition: number;
  cashCollected: number;
  expenseActual: number;
  payrollActual: number;
  actualExpenses: number;
};

export type BudgetExpenseCategoryActual = {
  month: string;
  categoryId: string;
  category: BudgetExpenseCategoryData;
  amount: number;
};

export type BudgetPlanReportData = {
  plan: BudgetPlanData;
  items: BudgetPlanItemData[];
  report: BudgetReport;
  monthlyActuals: BudgetMonthActuals[];
  expenseCategoryActuals: BudgetExpenseCategoryActual[];
};

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function month(value: Date): string {
  return value.toISOString().slice(0, 7);
}

function dayStart(value: Date): Date {
  return new Date(`${day(value)}T00:00:00.000Z`);
}

function dayAfter(value: Date): Date {
  const result = dayStart(value);
  result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

function monthsInRange(from: Date, to: Date): string[] {
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const last = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1);
  const result: string[] = [];
  while (cursor.getTime() <= last) {
    result.push(month(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

function add(target: Map<string, number>, key: string, amount: number): void {
  target.set(key, (target.get(key) ?? 0) + amount);
}

function increment(target: Map<string, number>, key: string): void {
  target.set(key, (target.get(key) ?? 0) + 1);
}

function money(value: number): number {
  const rounded = Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  return value < 0 ? -rounded : rounded;
}

/**
 * Load one budget and reconcile every calendar month touched by its inclusive
 * date range with operational and cash data.
 *
 * Forecast tuition is the value of work currently expected to happen:
 * scheduled, checked-in and completed bookings, plus no-shows only when the
 * centre bills them. Earned tuition uses the same central billing policy as
 * statements, allocations and payroll. Drafts and cancellations can therefore
 * never leak into either figure.
 */
export async function getBudgetPlanReport(
  planId: string,
): Promise<BudgetPlanReportData | null> {
  const plan = await db.budgetPlan.findUnique({
    where: { id: planId },
    include: {
      items: {
        include: {
          expenseCategory: {
            select: {
              id: true,
              nameAr: true,
              nameEn: true,
              sortOrder: true,
              active: true,
            },
          },
        },
        orderBy: [{ month: "asc" }, { kind: "asc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!plan) return null;

  const from = dayStart(plan.startDate);
  const to = dayStart(plan.endDate);
  const toExclusive = dayAfter(to);
  // paidAt is a real instant, unlike the UTC-component business dates used by
  // sessions and expenses. Query its exact Qatar calendar-day boundaries.
  const payrollFrom = new Date(`${day(from)}T00:00:00+03:00`);
  const payrollToExclusive = new Date(`${day(toExclusive)}T00:00:00+03:00`);
  const monthKeys = monthsInRange(from, to);
  const unchargeable = await unchargeableStatuses();
  // The query excludes drafts/cancellations up front; this predicate still
  // uses the central inverse because future financially-final statuses should
  // billing rule without another report-specific allow-list.
  const isEarned = (status: string) => !unchargeable.includes(status);
  const chargeNoShow = !unchargeable.includes("NO_SHOW");

  const [sessions, expenses, cashFlow, payouts] = await Promise.all([
    db.session.findMany({
      where: {
        date: { gte: from, lt: toExclusive },
        status: { notIn: ["DRAFT", "CANCELLED"] },
      },
      select: {
        date: true,
        status: true,
        total: true,
        hours: true,
        billableHours: true,
        package: { select: { price: true, totalHours: true } },
      },
    }),
    db.expense.findMany({
      where: {
        date: { gte: from, lt: toExclusive },
        status: { in: ["APPROVED", "POSTED"] },
      },
      select: {
        date: true,
        amount: true,
        categoryId: true,
        category: {
          select: {
            id: true,
            nameAr: true,
            nameEn: true,
            sortOrder: true,
            active: true,
          },
        },
      },
    }),
    getPaymentCashFlow({ from, to }),
    plan.includePayrollActual
      ? db.teacherPayout.findMany({
          where: {
            status: "PAID",
            OR: [
              { paidAt: { gte: payrollFrom, lt: payrollToExclusive } },
              // Ad-hoc payslips created before `paidAt` was populated remain
              // real costs. Their period end is the least-surprising month.
              { paidAt: null, periodEnd: { gte: from, lt: toExclusive } },
            ],
          },
          select: { paidAt: true, periodEnd: true, netPaid: true },
        })
      : Promise.resolve([]),
  ]);

  const forecastTuition = new Map<string, number>();
  const forecastSessions = new Map<string, number>();
  const earnedTuition = new Map<string, number>();
  const billableSessions = new Map<string, number>();
  for (const session of sessions) {
    const key = month(session.date);
    // A package-covered lesson must use the package's actual selling rate,
    // never the matrix price snapshotted on Session.total. This recognises the
    // service once as it is delivered while cash remains on the receipt date.
    const packageHours = toNumber(session.package?.totalHours);
    const recognizedHours = toNumber(session.billableHours ?? session.hours);
    const total = session.package && packageHours > 0
      ? (toNumber(session.package.price) / packageHours) * recognizedHours
      : toNumber(session.total);
    if (isForecastableSession(session.status, chargeNoShow)) {
      add(forecastTuition, key, total);
      increment(forecastSessions, key);
    }
    if (isEarned(session.status)) {
      add(earnedTuition, key, total);
      increment(billableSessions, key);
    }
  }

  const expenseActual = new Map<string, number>();
  const expenseCategoryActual = new Map<
    string,
    BudgetExpenseCategoryActual
  >();
  for (const expense of expenses) {
    const monthKey = month(expense.date);
    const amount = toNumber(expense.amount);
    add(expenseActual, monthKey, amount);
    const key = `${monthKey}:${expense.categoryId}`;
    const existing = expenseCategoryActual.get(key);
    if (existing) existing.amount += amount;
    else {
      expenseCategoryActual.set(key, {
        month: monthKey,
        categoryId: expense.categoryId,
        category: expense.category,
        amount,
      });
    }
  }

  const payrollActual = new Map<string, number>();
  for (const payout of payouts) {
    const key = payout.paidAt
      ? centerToday(payout.paidAt).slice(0, 7)
      : month(payout.periodEnd);
    add(payrollActual, key, toNumber(payout.netPaid));
  }

  const cashCollected = new Map(
    cashFlow.monthly.map((row) => [row.month, row.net] as const),
  );
  const plannedIncome = new Map<string, number>();
  const plannedFixedExpenses = new Map<string, number>();
  const plannedVariableExpenses = new Map<string, number>();
  for (const item of plan.items) {
    const key = month(item.month);
    const amount = toNumber(item.amount);
    if (item.kind === "INCOME") add(plannedIncome, key, amount);
    else if (item.kind === "EXPENSE" && item.behavior === "VARIABLE") {
      add(plannedVariableExpenses, key, amount);
    } else if (item.kind === "EXPENSE") {
      add(plannedFixedExpenses, key, amount);
    }
  }

  const monthlyActuals: BudgetMonthActuals[] = monthKeys.map((key) => {
    const operating = expenseActual.get(key) ?? 0;
    const payroll = plan.includePayrollActual ? (payrollActual.get(key) ?? 0) : 0;
    return {
      month: key,
      forecastSessions: forecastSessions.get(key) ?? 0,
      forecastTuition: money(forecastTuition.get(key) ?? 0),
      billableSessions: billableSessions.get(key) ?? 0,
      earnedTuition: money(earnedTuition.get(key) ?? 0),
      cashCollected: money(cashCollected.get(key) ?? 0),
      expenseActual: money(operating),
      payrollActual: money(payroll),
      actualExpenses: money(operating + payroll),
    };
  });

  const inputs: BudgetMonthInput[] = monthlyActuals.map((actual) => ({
    month: actual.month,
    plannedIncome: plannedIncome.get(actual.month) ?? 0,
    plannedFixedExpenses: plannedFixedExpenses.get(actual.month) ?? 0,
    plannedVariableExpenses: plannedVariableExpenses.get(actual.month) ?? 0,
    projectedIncome: actual.forecastTuition,
    forecastSessions: actual.forecastSessions,
    // There is no committed-expense table yet. Approved/posted expenses and
    // paid payroll are the truthful known cost forecast as well as actuals.
    projectedExpenses: actual.actualExpenses,
    earnedIncome: actual.earnedTuition,
    cashCollected: actual.cashCollected,
    actualExpenses: actual.actualExpenses,
    billableSessions: actual.billableSessions,
  }));

  return {
    plan: {
      id: plan.id,
      name: plan.name,
      startDate: day(plan.startDate),
      endDate: day(plan.endDate),
      status: plan.status,
      includePayrollActual: plan.includePayrollActual,
      notes: plan.notes,
      createdById: plan.createdById,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    },
    items: plan.items.map((item) => ({
      id: item.id,
      month: month(item.month),
      kind: item.kind,
      expenseCategoryId: item.expenseCategoryId,
      expenseCategory: item.expenseCategory,
      label: item.label,
      amount: toNumber(item.amount),
      behavior: item.behavior,
      notes: item.notes,
    })),
    report: buildBudgetReport(inputs),
    monthlyActuals,
    expenseCategoryActuals: [...expenseCategoryActual.values()]
      .map((row) => ({ ...row, amount: money(row.amount) }))
      .sort(
        (a, b) =>
          a.month.localeCompare(b.month) ||
          a.category.sortOrder - b.category.sortOrder ||
          a.category.nameEn.localeCompare(b.category.nameEn) ||
          a.categoryId.localeCompare(b.categoryId),
      ),
  };
}
