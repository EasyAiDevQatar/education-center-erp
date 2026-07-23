// Cheque lifecycle rules and cash-flow forecasting.
//
// Pure module (no imports beyond types) — ported from staff-flow's
// src/lib/checks.ts and its DB triggers, unit-tested here because a wrong
// transition or a wrong confidence weight is money misreported.

export type ChequeDirection = "INCOMING" | "OUTGOING";
export type ChequeStatus =
  | "DRAFT"
  | "RECEIVED"
  | "PENDING_DEPOSIT"
  | "DEPOSITED"
  | "CLEARED"
  | "BOUNCED"
  | "REPLACED"
  | "CANCELLED"
  | "VOID";

/**
 * Legal moves per direction. Terminal states have no exits except a bounced
 * incoming cheque, which may be REPLACED by a new cheque.
 */
export const CHEQUE_TRANSITIONS: Record<
  ChequeDirection,
  Partial<Record<ChequeStatus, ChequeStatus[]>>
> = {
  INCOMING: {
    DRAFT: ["RECEIVED", "CANCELLED", "VOID"],
    RECEIVED: ["PENDING_DEPOSIT", "DEPOSITED", "BOUNCED", "CANCELLED"],
    PENDING_DEPOSIT: ["DEPOSITED", "BOUNCED", "CANCELLED"],
    DEPOSITED: ["CLEARED", "BOUNCED"],
    BOUNCED: ["REPLACED"],
  },
  OUTGOING: {
    DRAFT: ["RECEIVED", "CANCELLED", "VOID"], // RECEIVED = handed to the payee
    RECEIVED: ["DEPOSITED", "CLEARED", "BOUNCED", "CANCELLED"],
    DEPOSITED: ["CLEARED", "BOUNCED"],
    BOUNCED: ["REPLACED"],
  },
};

export function canTransition(
  direction: ChequeDirection,
  from: ChequeStatus,
  to: ChequeStatus,
): boolean {
  return CHEQUE_TRANSITIONS[direction][from]?.includes(to) ?? false;
}

export type ChequeDates = {
  receivedDate?: Date | null;
  depositDate?: Date | null;
  clearanceDate?: Date | null;
};

/**
 * Date ordering: a cheque cannot clear before it was deposited, nor be
 * deposited before it was received. Returns an error key or null.
 */
export function validateChequeDates(d: ChequeDates): string | null {
  if (d.receivedDate && d.depositDate && d.depositDate < d.receivedDate) {
    return "depositBeforeReceived";
  }
  if (d.depositDate && d.clearanceDate && d.clearanceDate < d.depositDate) {
    return "clearanceBeforeDeposit";
  }
  return null;
}

export type ForecastSettings = {
  confidenceReceived: number; // %
  confidencePending: number;
  confidenceDeposited: number;
};

export const DEFAULT_FORECAST_SETTINGS: ForecastSettings = {
  confidenceReceived: 70,
  confidencePending: 80,
  confidenceDeposited: 95,
};

/** How likely this cheque's money is to arrive, by where it is in the flow. */
export function confidenceFor(status: ChequeStatus, s: ForecastSettings): number {
  switch (status) {
    case "CLEARED":
      return 100;
    case "DEPOSITED":
      return s.confidenceDeposited;
    case "PENDING_DEPOSIT":
      return s.confidencePending;
    case "RECEIVED":
      return s.confidenceReceived;
    default:
      return 0; // draft, bounced, cancelled, void, replaced: no expected cash
  }
}

export type ForecastCheque = {
  status: ChequeStatus;
  direction: ChequeDirection;
  amount: number;
  dueDate: Date | null;
};

/** A cheque is overdue when its due date passed and it still hasn't cleared. */
export function isOverdue(c: ForecastCheque, today: Date): boolean {
  if (!c.dueDate) return false;
  if (["CLEARED", "CANCELLED", "VOID", "REPLACED", "BOUNCED"].includes(c.status)) return false;
  return c.dueDate.getTime() < today.getTime();
}

export type AgeBuckets = { current: number; d7: number; d30: number; d60: number; d60Plus: number };

/** Sum OPEN incoming amounts into how-long-overdue buckets (days past due). */
export function ageBuckets(cheques: ForecastCheque[], today: Date): AgeBuckets {
  const out: AgeBuckets = { current: 0, d7: 0, d30: 0, d60: 0, d60Plus: 0 };
  for (const c of cheques) {
    if (c.direction !== "INCOMING") continue;
    if (["CLEARED", "CANCELLED", "VOID", "REPLACED", "BOUNCED", "DRAFT"].includes(c.status)) continue;
    if (!c.dueDate || c.dueDate.getTime() >= today.getTime()) {
      out.current += c.amount;
      continue;
    }
    const days = Math.floor((today.getTime() - c.dueDate.getTime()) / 86_400_000);
    if (days <= 7) out.d7 += c.amount;
    else if (days <= 30) out.d30 += c.amount;
    else if (days <= 60) out.d60 += c.amount;
    else out.d60Plus += c.amount;
  }
  return out;
}

export type ForecastPoint = { label: string; gross: number; weighted: number };

/**
 * Cash-flow projection over the coming weeks: for each period, the sum of
 * open incoming cheques falling due minus open outgoing ones, both raw and
 * confidence-weighted. Periods key on the due date; cheques with no due date
 * are excluded (nothing to project).
 */
export function buildForecastSeries(
  cheques: ForecastCheque[],
  weeks: number,
  settings: ForecastSettings,
  today: Date,
): ForecastPoint[] {
  const start = new Date(today);
  start.setUTCHours(0, 0, 0, 0);
  const points: ForecastPoint[] = [];
  for (let w = 0; w < weeks; w++) {
    const from = new Date(start.getTime() + w * 7 * 86_400_000);
    const to = new Date(from.getTime() + 7 * 86_400_000);
    let gross = 0;
    let weighted = 0;
    for (const c of cheques) {
      if (!c.dueDate) continue;
      if (["CLEARED", "CANCELLED", "VOID", "REPLACED", "BOUNCED", "DRAFT"].includes(c.status)) {
        continue;
      }
      // Overdue cheques land in the first week — they are expected "now".
      const due = c.dueDate.getTime() < start.getTime() && w === 0 ? from : c.dueDate;
      if (due < from || due >= to) continue;
      const sign = c.direction === "INCOMING" ? 1 : -1;
      gross += sign * c.amount;
      weighted += sign * c.amount * (confidenceFor(c.status, settings) / 100);
    }
    points.push({ label: from.toISOString().slice(0, 10), gross, weighted });
  }
  return points;
}
