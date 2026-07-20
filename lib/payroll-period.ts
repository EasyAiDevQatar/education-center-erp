/** Pure period helpers for payroll modes — no DB, so they are unit-testable.
 *  All dates are `YYYY-MM-DD` wall-clock strings, matching the app convention. */

export type PayMode = "SESSION" | "MONTH" | "TERM";

/** Resolve the effective mode: the teacher's own, else the centre default. */
export function effectiveMode(
  teacherMode: string | null | undefined,
  centreDefault: string | null | undefined,
): PayMode {
  const valid = (v: unknown): v is PayMode =>
    v === "SESSION" || v === "MONTH" || v === "TERM";
  if (valid(teacherMode)) return teacherMode;
  if (valid(centreDefault)) return centreDefault;
  return "MONTH";
}

/** First and last day of a `YYYY-MM` month. */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) {
    const now = new Date();
    return monthRange(
      `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
  const p = (n: number) => String(n).padStart(2, "0");
  return { from: `${y}-${p(m)}-01`, to: `${y}-${p(m)}-${p(last)}` };
}

/** The `YYYY-MM` a date belongs to. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * Which period the payroll screen should default to for a mode.
 * SESSION keeps whatever range the user already had (free-form).
 */
export function defaultPeriodFor(
  mode: PayMode,
  opts: {
    today: string;
    currentTerm?: { startDate: string; endDate: string } | null;
    fallback: { from: string; to: string };
  },
): { from: string; to: string } {
  if (mode === "MONTH") return monthRange(monthOf(opts.today));
  if (mode === "TERM" && opts.currentTerm) {
    return { from: opts.currentTerm.startDate, to: opts.currentTerm.endDate };
  }
  return opts.fallback;
}
