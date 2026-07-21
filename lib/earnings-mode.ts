/**
 * What a teacher is owed: salary, commission, or both.
 *
 * Deliberately separate from `paymentMode` (SESSION | MONTH | TERM), which only
 * decides *how often* a payout is cut. A teacher on a fixed monthly salary and
 * a teacher on pure commission can both be paid monthly; conflating the two
 * would force the centre to choose a period in order to express a pay structure.
 *
 * Pure functions with no imports — `server-only` modules cannot be unit tested,
 * and this is money.
 */

export const EARNINGS_MODES = ["SALARY", "COMMISSION", "BOTH"] as const;
export type EarningsMode = (typeof EARNINGS_MODES)[number];

export const DEFAULT_EARNINGS_MODE: EarningsMode = "COMMISSION";

export function isEarningsMode(v: unknown): v is EarningsMode {
  return typeof v === "string" && (EARNINGS_MODES as readonly string[]).includes(v);
}

/**
 * The mode in force for one teacher.
 *
 * A null on the teacher means "follow the centre", so changing the centre
 * default moves everyone who never opted out — which is the point of having a
 * default at all.
 */
export function resolveEarningsMode(
  teacherMode: string | null | undefined,
  centreDefault: string | null | undefined,
): EarningsMode {
  if (isEarningsMode(teacherMode)) return teacherMode;
  if (isEarningsMode(centreDefault)) return centreDefault;
  return DEFAULT_EARNINGS_MODE;
}

export type PayComponents = {
  commission: number;
  salary: number;
  deductions: number;
  /** Ad-hoc advances already handed over, subtracted from the payout. */
  advances?: number;
};

export type PayBreakdown = {
  mode: EarningsMode;
  /** Commission counted toward this payout — zero under SALARY. */
  commission: number;
  /** Salary counted toward this payout — zero under COMMISSION. */
  salary: number;
  deductions: number;
  advances: number;
  /** commission + salary − deductions − advances, never below zero. */
  net: number;
};

/**
 * Apply a mode to a set of components.
 *
 * Suppressed components are reported as zero rather than dropped, so a payslip
 * can still show "commission: 0" and a reader can tell the difference between
 * "earned nothing" and "not on commission" from the mode beside it.
 *
 * Deductions and advances apply under every mode: they are money owed back to
 * the centre, not a function of how the teacher earns.
 */
export function computePay(mode: EarningsMode, c: PayComponents): PayBreakdown {
  const commission = mode === "SALARY" ? 0 : c.commission;
  const salary = mode === "COMMISSION" ? 0 : c.salary;
  const deductions = c.deductions;
  const advances = c.advances ?? 0;
  // A payout is never negative: the centre does not invoice a teacher through
  // payroll, and a negative net would silently subtract from the month's cash.
  const net = Math.max(0, commission + salary - deductions - advances);
  return { mode, commission, salary, deductions, advances, net };
}

/**
 * Whether a salary column is worth showing for this set of teachers.
 *
 * A column of zeroes is noise on a screen that is already dense, so it appears
 * only once at least one teacher on it actually draws a salary.
 */
export function anySalary(
  rows: { fixedSalary: number; earningsMode?: string | null }[],
  centreDefault?: string | null,
): boolean {
  return rows.some(
    (r) =>
      r.fixedSalary > 0 && resolveEarningsMode(r.earningsMode, centreDefault) !== "COMMISSION",
  );
}
