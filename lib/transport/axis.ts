// The time axis every transport board draws against.
//
// Pure module (no imports) so it is unit-tested, and shared so the dispatch
// board and the master planner cannot drift apart into two subtly different
// timelines — which is exactly how a trip ends up a different width on two
// screens showing the same day.
//
// The axis is a fixed working window, NOT the extent of what happens to be
// booked. Deriving it from the data made a single trip stretch across the whole
// board, so two lanes an hour apart looked like a full day.

/** Earliest the centre ever operates. */
export const DAY_OPEN_MIN = 7 * 60; // 07:00
/** Latest — 02:00 the following morning. */
export const DAY_CLOSE_MIN = 26 * 60;
/** Shown even when nothing is booked in it. */
export const WINDOW_FROM_MIN = 14 * 60; // 14:00
export const WINDOW_TO_MIN = 22 * 60; // 22:00

export type DayAxis = { minMin: number; maxMin: number };

/**
 * The window to draw for a day.
 *
 * Always covers the working window; grows outward, to the hour, only where
 * something is genuinely scheduled; never past the hours the centre can run.
 */
export function dayAxis(minutes: readonly number[]): DayAxis {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const m of minutes) {
    if (!Number.isFinite(m)) continue;
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }

  const earliest = Number.isFinite(lo) ? Math.floor(lo / 60) * 60 : WINDOW_FROM_MIN;
  const latest = Number.isFinite(hi) ? Math.ceil(hi / 60) * 60 : WINDOW_TO_MIN;

  return {
    minMin: Math.max(DAY_OPEN_MIN, Math.min(WINDOW_FROM_MIN, earliest)),
    maxMin: Math.min(DAY_CLOSE_MIN, Math.max(WINDOW_TO_MIN, latest)),
  };
}

/** Where a minute sits on the axis, as a percentage from the inline start. */
export function axisPct(axis: DayAxis, minute: number): number {
  const range = Math.max(1, axis.maxMin - axis.minMin);
  return ((minute - axis.minMin) / range) * 100;
}

/** Hour ticks across the axis, inclusive of both ends. */
export function axisTicks(axis: DayAxis): number[] {
  const from = Math.floor(axis.minMin / 60) * 60;
  const to = Math.ceil(axis.maxMin / 60) * 60;
  const out: number[] = [];
  for (let m = from; m <= to; m += 60) out.push(m);
  return out;
}
