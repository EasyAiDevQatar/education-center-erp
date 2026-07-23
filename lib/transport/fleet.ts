// Fleet paperwork and driver-shift rules.
//
// Pure module — no imports, no `server-only` — so the alerting logic that
// decides "this vehicle is uninsured" is unit-testable rather than buried in a
// page component.
//
// Shift times are minutes from midnight, matching lib/planner.ts and the
// allocator's DriverState.

/** Documents are flagged this many days ahead, matching the HR register. */
export const EXPIRY_WINDOW_DAYS = 60;

/**
 * How urgent an expiry is. `unknown` is deliberately distinct from `ok`: a
 * document with no expiry date recorded is not a document that is fine, and
 * showing it as green is how uninsured cars end up on the road.
 */
export type ExpiryLevel = "expired" | "soon" | "ok" | "unknown";

/**
 * Whole days from `today` until `expiresOn`; negative once past. Both sides are
 * truncated to their UTC date first, so a document expiring later today reads
 * as 0 (expires today) rather than a fraction of a day.
 */
export function daysUntil(
  expiresOn: Date | null | undefined,
  today: Date,
): number | null {
  if (!expiresOn) return null;
  const a = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const b = Date.UTC(
    expiresOn.getUTCFullYear(),
    expiresOn.getUTCMonth(),
    expiresOn.getUTCDate(),
  );
  return Math.round((b - a) / 86_400_000);
}

/** Bucket an expiry date for display and alerting. */
export function expiryLevel(
  expiresOn: Date | null | undefined,
  today: Date,
  windowDays: number = EXPIRY_WINDOW_DAYS,
): ExpiryLevel {
  const d = daysUntil(expiresOn, today);
  if (d === null) return "unknown";
  if (d < 0) return "expired";
  return d <= windowDays ? "soon" : "ok";
}

/**
 * The newest row per document type.
 *
 * A renewal is a new row (never an edit), so a vehicle accumulates several
 * INSURANCE rows and only the latest one says whether it is insured today.
 * Alerting on every row would keep screaming about the superseded ones.
 *
 * "Newest" is by `expiresOn` — the date that decides validity. Rows with no
 * expiry lose to any row that has one, and win only when nothing else exists
 * for that type.
 */
export function latestPerType<T extends { type: string; expiresOn: Date | null }>(
  docs: T[],
): T[] {
  const best = new Map<string, T>();
  for (const doc of docs) {
    const current = best.get(doc.type);
    if (!current) {
      best.set(doc.type, doc);
      continue;
    }
    if (current.expiresOn === null && doc.expiresOn !== null) {
      best.set(doc.type, doc);
    } else if (
      current.expiresOn !== null &&
      doc.expiresOn !== null &&
      doc.expiresOn > current.expiresOn
    ) {
      best.set(doc.type, doc);
    }
  }
  return [...best.values()];
}

/**
 * A shift window is usable by the allocator only when both ends are set and the
 * start is strictly before the end. Half-set windows are treated as "no shift"
 * (always available) rather than guessed at — an assumed end time would silently
 * strand a passenger.
 */
export function shiftIsValid(
  startMin: number | null | undefined,
  endMin: number | null | undefined,
): boolean {
  if (startMin == null || endMin == null) return false;
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return false;
  if (startMin < 0 || endMin > 24 * 60) return false;
  return startMin < endMin;
}

/** Whether [fromMin, toMin] fits inside the driver's shift. No shift = always. */
export function shiftCovers(
  startMin: number | null | undefined,
  endMin: number | null | undefined,
  fromMin: number,
  toMin: number,
): boolean {
  if (!shiftIsValid(startMin, endMin)) return true;
  return fromMin >= (startMin as number) && toMin <= (endMin as number);
}

/**
 * Can this driver be dispatched at all today? Used to grey out a driver in the
 * register and to keep them out of the allocation pool.
 *
 * An expired licence is disqualifying, not advisory: driving on one is illegal
 * and uninsured. A licence with no recorded expiry is allowed through (the
 * centre may simply not have entered it yet) but surfaces as `unknown`.
 */
export function driverIsDispatchable(
  driver: { active: boolean; licenceExpiry: Date | null },
  today: Date,
): boolean {
  if (!driver.active) return false;
  return expiryLevel(driver.licenceExpiry, today) !== "expired";
}
