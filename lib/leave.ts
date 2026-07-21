/**
 * Qatar leave rules (Labour Law No. 14 of 2004).
 *
 * Annual leave: three weeks (21 days) for under five years of service, four
 * weeks (28 days) at five years or more. Sick leave: 14 fully-paid days once
 * three months of service are complete. Annual leave is counted in CALENDAR
 * days — weekends inside a leave block are part of the leave.
 *
 * Pure functions with no imports — `server-only` modules cannot be unit
 * tested, and leave converts directly into money at settlement time.
 */

export const ANNUAL_DAYS_UNDER_5 = 21;
export const ANNUAL_DAYS_5_PLUS = 28;
export const SICK_FULL_PAY_DAYS = 14;
export const SICK_ELIGIBLE_AFTER_MONTHS = 3;

const MS_DAY = 86400000;

function parse(d: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.parse(`${d}T00:00:00.000Z`);
  return Number.isNaN(t) ? null : t;
}

/** Whole years of service at `asOf`, by anniversary — not by day count / 365. */
export function serviceYearsAt(hireDate: string, asOf: string): number {
  const h = parse(hireDate);
  const a = parse(asOf);
  if (h === null || a === null || a < h) return 0;
  const hd = new Date(h);
  const ad = new Date(a);
  let years = ad.getUTCFullYear() - hd.getUTCFullYear();
  const anniv = Date.UTC(hd.getUTCFullYear() + years, hd.getUTCMonth(), hd.getUTCDate());
  if (anniv > a) years -= 1;
  return Math.max(0, years);
}

/** The annual entitlement rate for a given completed-years figure. `>=` — the
    fifth anniversary itself is already at the higher rate. */
export function annualRateForService(serviceYears: number): number {
  return serviceYears >= 5 ? ANNUAL_DAYS_5_PLUS : ANNUAL_DAYS_UNDER_5;
}

/**
 * Annual-leave days accrued inside one leave year, up to `asOf`.
 *
 * Accrues month by month at the rate in force in that month, so the leave year
 * containing the fifth service anniversary blends 21/12 and 28/12 rather than
 * jumping wholesale — more defensible to an employee on either side of the
 * anniversary, and far more testable than "evaluate at year end".
 */
export function annualAccruedDays(i: {
  hireDate: string;
  asOf: string;
  yearStart: string;
  yearEnd: string;
  ratePerYearUnder5?: number;
  ratePerYear5Plus?: number;
}): number {
  const hire = parse(i.hireDate);
  const ys = parse(i.yearStart);
  const ye = parse(i.yearEnd);
  let asOf = parse(i.asOf);
  if (hire === null || ys === null || ye === null || asOf === null) return 0;
  // Accrual never runs past the leave year, and never before the hire date.
  if (asOf > ye) asOf = ye;
  const from = Math.max(ys, hire);
  if (asOf < from) return 0;

  const under5 = (i.ratePerYearUnder5 ?? ANNUAL_DAYS_UNDER_5) / 12;
  const plus5 = (i.ratePerYear5Plus ?? ANNUAL_DAYS_5_PLUS) / 12;

  // Walk calendar months touched by [from, asOf]; each contributes its rate
  // pro-rated by the fraction of the month actually covered.
  let total = 0;
  const cur = new Date(from);
  cur.setUTCDate(1);
  while (cur.getTime() <= asOf) {
    const mStart = Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), 1);
    const mEnd = Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1) - MS_DAY;
    const covFrom = Math.max(mStart, from);
    const covTo = Math.min(mEnd, asOf);
    if (covTo >= covFrom) {
      const daysInMonth = Math.round((mEnd - mStart) / MS_DAY) + 1;
      const covered = Math.round((covTo - covFrom) / MS_DAY) + 1;
      // The rate in force is decided by service years at the month's start
      // (clamped to the hire date for the hire month itself).
      const probe = new Date(Math.max(mStart, hire)).toISOString().slice(0, 10);
      const rate =
        serviceYearsAt(i.hireDate, probe) >= 5 ? plus5 : under5;
      total += rate * (covered / daysInMonth);
    }
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  // One rounding, at the boundary — half-day precision is what HR actually uses.
  return Math.round(total * 2) / 2;
}

/** Sick pay needs three completed calendar months, not 90 days. */
export function sickEligible(hireDate: string, asOf: string): boolean {
  const h = parse(hireDate);
  const a = parse(asOf);
  if (h === null || a === null) return false;
  const hd = new Date(h);
  // Clamp month-end: hired 30 Nov → three months complete end of February.
  const m = hd.getUTCMonth() + SICK_ELIGIBLE_AFTER_MONTHS;
  const lastOfTarget = new Date(Date.UTC(hd.getUTCFullYear(), m + 1, 0)).getUTCDate();
  const threshold = Date.UTC(
    hd.getUTCFullYear(),
    m,
    Math.min(hd.getUTCDate(), lastOfTarget),
  );
  return a >= threshold;
}

/** Split a sick request into fully-paid vs unpaid against the annual cap. */
export function sickPaidDays(i: {
  requestedDays: number;
  alreadyTakenDays: number;
  capDays?: number;
}): { fullPay: number; unpaid: number } {
  const cap = i.capDays ?? SICK_FULL_PAY_DAYS;
  const remaining = Math.max(0, cap - Math.max(0, i.alreadyTakenDays));
  const fullPay = Math.min(Math.max(0, i.requestedDays), remaining);
  return { fullPay, unpaid: Math.max(0, i.requestedDays - fullPay) };
}

/**
 * Days in a leave block, inclusive of BOTH endpoints — a single-day request is
 * one day, not zero. Defaults to calendar days (Qatari annual leave counts
 * them); pass `weekend` (getUTCDay numbers, e.g. [5,6] for Fri/Sat) to count
 * working days instead. Holidays are deduplicated against the weekend so a
 * holiday on a Friday is not subtracted twice.
 */
export function leaveDays(
  startDate: string,
  endDate: string,
  opts?: { weekend?: number[]; holidays?: string[] },
): number {
  const s = parse(startDate);
  const e = parse(endDate);
  if (s === null || e === null || e < s) return 0;
  const weekend = new Set(opts?.weekend ?? []);
  const holidays = new Set(opts?.holidays ?? []);
  let n = 0;
  for (let t = s; t <= e; t += MS_DAY) {
    const d = new Date(t);
    if (weekend.has(d.getUTCDay())) continue;
    if (holidays.has(d.toISOString().slice(0, 10))) continue;
    n += 1;
  }
  return n;
}

/**
 * A balance line. NOT floored at zero — a negative remaining is a fact HR must
 * see (someone was granted more than they had), unlike a payslip net where a
 * negative number would be meaningless.
 */
export function balance(i: {
  entitlement: number;
  adjustments: number;
  approvedTaken: number;
  pendingTaken?: number;
}): {
  entitlement: number;
  adjustments: number;
  taken: number;
  pending: number;
  remaining: number;
  available: number;
} {
  const pending = i.pendingTaken ?? 0;
  const remaining = i.entitlement + i.adjustments - i.approvedTaken;
  return {
    entitlement: i.entitlement,
    adjustments: i.adjustments,
    taken: i.approvedTaken,
    pending,
    remaining,
    // What can still be requested — pending requests are spoken for.
    available: remaining - pending,
  };
}

/** Inclusive overlap at both ends, symmetric. */
export function overlaps(
  a: { start: string; end: string },
  b: { start: string; end: string },
): boolean {
  const as = parse(a.start);
  const ae = parse(a.end);
  const bs = parse(b.start);
  const be = parse(b.end);
  if (as === null || ae === null || bs === null || be === null) return false;
  return as <= be && bs <= ae;
}
