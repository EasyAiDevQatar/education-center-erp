import { centerToday } from "./session-time";

export type CashFlowNumber = number | string | { toString(): string } | null | undefined;

export type PaymentCashFlowInput = {
  /** Stored receipt date; interpreted using its UTC date components. */
  date: Date | string;
  method: string;
  amount: CashFlowNumber;
  status: string;
  refundAmount: CashFlowNumber;
  /** Real refund/cancellation timestamp; refunds use its Qatar calendar date. */
  voidedAt: Date | string | null;
};

export type CashFlowDateRange = {
  /** Inclusive YYYY-MM-DD boundary. */
  from?: string;
  /** Inclusive YYYY-MM-DD boundary. */
  to?: string;
};

export type PaymentCashFlowMethodRow = {
  method: string;
  count: number;
  refundCount: number;
  gross: number;
  refunded: number;
  net: number;
  /** Share of positive net collections, rounded to one decimal. */
  pct: number;
};

export type PaymentCashFlowMonthRow = {
  month: string;
  count: number;
  refundCount: number;
  gross: number;
  refunded: number;
  net: number;
};

export type PaymentCashFlowReport = {
  totals: Omit<PaymentCashFlowMethodRow, "method" | "pct">;
  methods: PaymentCashFlowMethodRow[];
  monthly: PaymentCashFlowMonthRow[];
};

type CashFlowAccumulator = {
  count: number;
  refundCount: number;
  gross: number;
  refunded: number;
};

function emptyAccumulator(): CashFlowAccumulator {
  return { count: 0, refundCount: 0, gross: 0, refunded: 0 };
}

function amount(value: CashFlowNumber): number {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function validDay(value?: string): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

/** Payment dates are date-only business values encoded in UTC. */
function paymentDay(value: Date | string): string | null {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** voidedAt is a real instant, so its business date is Qatar's calendar date. */
function refundDay(value: Date | string | null): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : centerToday(parsed);
}

function inRange(day: string, from?: string, to?: string): boolean {
  return (!from || day >= from) && (!to || day <= to);
}

function addGross(target: CashFlowAccumulator, value: number): void {
  target.count++;
  target.gross += value;
}

function addRefund(target: CashFlowAccumulator, value: number): void {
  target.refundCount++;
  target.refunded += value;
}

function finalize<T extends CashFlowAccumulator>(row: T): T & { net: number } {
  return {
    ...row,
    gross: round(row.gross),
    refunded: round(row.refunded),
    net: round(row.gross - row.refunded),
  };
}

/**
 * Builds a cash-flow report from immutable payment records.
 *
 * A completed/refunded receipt contributes gross cash on its stored receipt
 * date. A refund contributes an outflow on `voidedAt`, converted to Qatar's
 * calendar date. Cancelled receipts contribute neither. With no date bounds,
 * every refund is included; a legacy refund without `voidedAt` falls back to
 * its payment date so lifetime and monthly totals still reconcile. With a
 * bounded period, an undated refund is excluded because it cannot be assigned
 * truthfully to that period.
 */
export function buildPaymentCashFlowReport(
  payments: PaymentCashFlowInput[],
  range?: CashFlowDateRange,
): PaymentCashFlowReport {
  const from = validDay(range?.from);
  const to = validDay(range?.to);
  const bounded = Boolean(from || to);
  const byMethod = new Map<string, CashFlowAccumulator>();
  const byMonth = new Map<string, CashFlowAccumulator>();

  const methodRow = (method: string) => {
    const current = byMethod.get(method) ?? emptyAccumulator();
    byMethod.set(method, current);
    return current;
  };
  const monthRow = (day: string) => {
    const month = day.slice(0, 7);
    const current = byMonth.get(month) ?? emptyAccumulator();
    byMonth.set(month, current);
    return current;
  };

  for (const payment of payments) {
    if (payment.status === "CANCELLED") continue;
    const collected = amount(payment.amount);
    const collectedDay = paymentDay(payment.date);
    if (collected > 0 && collectedDay && inRange(collectedDay, from, to)) {
      addGross(methodRow(payment.method), collected);
      addGross(monthRow(collectedDay), collected);
    }

    if (payment.status !== "REFUNDED") continue;
    const returned = amount(payment.refundAmount);
    if (returned <= 0) continue;
    const actualRefundDay = refundDay(payment.voidedAt);
    const effectiveRefundDay = actualRefundDay ?? (!bounded ? collectedDay : null);
    if (!effectiveRefundDay || !inRange(effectiveRefundDay, from, to)) continue;
    addRefund(methodRow(payment.method), returned);
    addRefund(monthRow(effectiveRefundDay), returned);
  }

  const totalAccumulator = [...byMethod.values()].reduce(
    (total, row) => ({
      count: total.count + row.count,
      refundCount: total.refundCount + row.refundCount,
      gross: total.gross + row.gross,
      refunded: total.refunded + row.refunded,
    }),
    emptyAccumulator(),
  );
  const totals = finalize(totalAccumulator);
  const methods = [...byMethod.entries()]
    .map(([method, row]) => {
      const finalized = finalize(row);
      return {
        method,
        ...finalized,
        pct: totals.net > 0 ? Math.round((finalized.net / totals.net) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.net - a.net || a.method.localeCompare(b.method));
  const monthly = [...byMonth.entries()]
    .map(([month, row]) => ({ month, ...finalize(row) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return { totals, methods, monthly };
}
