// Why a ride cannot be planned — told apart from "no driver was free".
//
// Pure module (no imports) so the rules are unit-tested. Some legs are not
// hard to schedule, they are impossible before any driver is considered: a
// teacher booked into two places at once leaves a gap no vehicle can cross.
//
// Until now those arrived at the allocator like any other leg, failed the
// deadline check, and were reported as `tooLate` — the same word used for a
// journey that was merely a few minutes tight. So a double-booked teacher and
// a near-miss looked identical on the board, and the actual defect (the
// schedule) stayed invisible while transport took the blame.
//
// This module names the difference, so the board can say "these two lessons
// overlap" instead of "too late", and point at the thing that needs fixing.

/** One lesson reduced to the window a passenger is committed to it. */
export type SessionWindow = {
  sessionId: string;
  label: string;
  startMin: number;
  endMin: number;
};

/** Two lessons the same person is booked into at the same time. */
export type SessionOverlap = {
  a: SessionWindow;
  b: SessionWindow;
  /** Minutes of collision — how far the later start precedes the earlier end. */
  overlapMin: number;
};

/**
 * Every pair of a passenger's lessons that collide.
 *
 * Touching is not overlapping: a lesson ending at 15:00 and the next starting
 * at 15:00 is a normal back-to-back day, tight but real.
 */
export function overlappingSessions(points: SessionWindow[]): SessionOverlap[] {
  const sorted = [...points].sort((x, y) => x.startMin - y.startMin);
  const out: SessionOverlap[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (b.startMin >= a.endMin) break; // sorted: nothing later can overlap a
      out.push({ a, b, overlapMin: Math.min(a.endMin, b.endMin) - b.startMin });
    }
  }
  return out;
}

/** Why a leg could never be scheduled, whatever the fleet looked like. */
export type LegImpossibility =
  /** The deadline falls before the passenger is even free to leave. */
  | "windowInverted"
  /** Coordinates are missing at one end. */
  | "missingLocation";

export type LegFeasibility = {
  possible: boolean;
  reason?: LegImpossibility;
  /** Minutes by which the window is inverted — the size of the conflict. */
  shortfallMin?: number;
};

/**
 * Can this leg exist at all?
 *
 * Answered before allocation and independently of it: a leg whose deadline
 * precedes its ready time is impossible for every driver, so reporting it as
 * "no driver could make it" blames the fleet for a scheduling error.
 */
export function legFeasibility(leg: {
  readyMin: number;
  dueMin: number;
  hasFrom?: boolean;
  hasTo?: boolean;
}): LegFeasibility {
  if (leg.hasFrom === false || leg.hasTo === false) {
    return { possible: false, reason: "missingLocation" };
  }
  if (leg.dueMin < leg.readyMin) {
    return {
      possible: false,
      reason: "windowInverted",
      shortfallMin: leg.readyMin - leg.dueMin,
    };
  }
  return { possible: true };
}

/**
 * A passenger's uncovered time — the minutes they are neither in a lesson nor
 * being driven.
 *
 * This is what an idle figure should measure. The raw gap between two trips is
 * not idleness: a teacher dropped at 13:45 and collected at 19:42 who taught
 * continuously in between was never waiting, and reporting six hours of idle
 * time there would be plainly wrong.
 */
export function uncoveredMinutes(
  sessions: SessionWindow[],
  fromMin: number,
  toMin: number,
): number {
  if (toMin <= fromMin) return 0;
  const merged: { s: number; e: number }[] = [];
  for (const w of [...sessions].sort((x, y) => x.startMin - y.startMin)) {
    const s = Math.max(fromMin, w.startMin);
    const e = Math.min(toMin, w.endMin);
    if (e <= s) continue;
    const last = merged[merged.length - 1];
    if (last && s <= last.e) last.e = Math.max(last.e, e);
    else merged.push({ s, e });
  }
  const busy = merged.reduce((acc, m) => acc + (m.e - m.s), 0);
  return Math.max(0, toMin - fromMin - busy);
}
