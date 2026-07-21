/** Pure academic-year range maths (no DB access — unit tested). */

export type YearRange = { start: Date; end: Date };

/** Is this instant inside the range? Both ends are inclusive. */
export function inRange(date: Date, r: YearRange): boolean {
  return date >= r.start && date <= r.end;
}

/**
 * Does any of these dates fall inside any of these ranges?
 *
 * The write guard passes both a record's old and new date, so a single true
 * here means the write touches frozen history in at least one direction.
 * Null/undefined dates are ignored — a missing date can't be in a year.
 */
export function anyDateInRanges(
  ranges: YearRange[],
  dates: (Date | string | null | undefined)[],
): boolean {
  if (ranges.length === 0) return false;
  for (const date of dates) {
    if (!date) continue;
    const d = typeof date === "string" ? new Date(date) : date;
    if (Number.isNaN(d.getTime())) continue;
    if (ranges.some((r) => inRange(d, r))) return true;
  }
  return false;
}

/** Do two ranges share any day? Used to reject overlapping years. */
export function rangesOverlap(a: YearRange, b: YearRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}
