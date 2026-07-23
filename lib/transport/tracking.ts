// Should this GPS fix be recorded?
//
// Pure module — no imports, no browser APIs — because every bug in the
// reference implementation we ported from lived in exactly this decision, and
// none of them were reachable by a test there:
//
//   * no accuracy filter, so a 2 km cell-tower fix landed in the polyline
//     looking identical to a 5 m GPS fix;
//   * the "last sent" timestamp was advanced BEFORE the write, so a failed
//     insert lost the ping *and* suppressed the next one for a full interval;
//   * distance was never considered, so a parked car wrote a fix every 15 s
//     while a car crossing town wrote no more than one.
//
// Here the decision is a function of (fix, last accepted fix, policy), the
// caller advances its cursor only after a successful write, and every rule
// above is a test below.

export type Fix = {
  lat: number;
  lng: number;
  /** Reported accuracy in metres; undefined when the browser omits it. */
  accuracyM?: number | null;
  /** Epoch milliseconds. */
  at: number;
};

export type TrackingPolicy = {
  /** Send at least this often while moving or still. */
  minIntervalMs: number;
  /** …or as soon as the driver has moved this far. */
  minDistanceM: number;
  /** Reject fixes less accurate than this. */
  maxAccuracyM: number;
};

export const DEFAULT_TRACKING_POLICY: TrackingPolicy = {
  minIntervalMs: 30_000,
  minDistanceM: 50,
  maxAccuracyM: 100,
};

export type PingDecision =
  | { send: true; reason: "first" | "interval" | "distance" }
  | { send: false; reason: "inaccurate" | "tooSoon" | "invalid" };

/** Metres between two coordinates (haversine, mean Earth radius). */
export function metresBetween(a: Fix, b: Fix): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Decide whether to record `fix`.
 *
 * `lastSent` is the last fix that was SUCCESSFULLY written — not the last one
 * seen. Passing the last *attempted* fix is the bug this signature exists to
 * prevent: a dropped write must be retried, not skipped.
 */
export function shouldSendPing(
  fix: Fix,
  lastSent: Fix | null,
  policy: TrackingPolicy = DEFAULT_TRACKING_POLICY,
): PingDecision {
  if (
    !Number.isFinite(fix.lat) ||
    !Number.isFinite(fix.lng) ||
    Math.abs(fix.lat) > 90 ||
    Math.abs(fix.lng) > 180
  ) {
    return { send: false, reason: "invalid" };
  }

  // A fix the device itself calls vague is worse than no fix: it draws a
  // confident line through a street the car was never on.
  if (fix.accuracyM != null && fix.accuracyM > policy.maxAccuracyM) {
    return { send: false, reason: "inaccurate" };
  }

  if (!lastSent) return { send: true, reason: "first" };

  if (fix.at - lastSent.at >= policy.minIntervalMs) {
    return { send: true, reason: "interval" };
  }
  if (metresBetween(lastSent, fix) >= policy.minDistanceM) {
    return { send: true, reason: "distance" };
  }
  return { send: false, reason: "tooSoon" };
}

/**
 * Rows older than the retention window, given "now".
 *
 * Exposed as a pure function so the cron's prune boundary is testable without
 * a database.
 */
export function pingCutoff(now: Date, retentionDays: number): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - Math.max(1, Math.floor(retentionDays)));
  return cutoff;
}
