// Fitting a planned trip onto the road times the router actually returned.
//
// Pure module (no imports) — extracted from trip-data.ts because this is where
// two separate defects have now shipped, and neither was reachable by the unit
// tests: the arithmetic lived inline in the middle of a 200-line assembly
// function that needs a database to run at all.
//
// The job: the allocator picks a driver and provisional times from a coarse
// estimate. Once the routing matrix is in, every hop has a real duration, and
// the schedule has to be rebuilt around it without breaking a promise already
// made to a passenger.
//
// Two rules, both learned the hard way:
//
//   1. Anchor on the TIGHTEST stop, never simply the last one. On a trip that
//      carries a delivery and then the ride home, the last stop is the ride
//      home — which has no deadline — so anchoring there dragged the delivery
//      in the middle nearly two hours past the start of its lesson.
//   2. Respect the collect floor. A passenger cannot be collected before their
//      previous lesson ends, so if honouring every promise would require
//      starting earlier than that, the trip is pinned to the floor and the
//      arrival slips visibly — which the validator then reports, rather than
//      the schedule quietly pretending to fit.

export type RetimeStop = {
  /** The time the allocator promised for this stop. */
  plannedMin: number;
};

export type RetimeInput = {
  stops: RetimeStop[];
  /**
   * Minutes to travel INTO each stop, including service and traffic
   * allowances. Index 0 is unused (nothing precedes the first stop).
   */
  hopMin: number[];
  /** Earliest the passenger may be collected; null when unconstrained. */
  collectFloor?: number | null;
};

export type RetimeResult = {
  /** New times, one per stop, in the same order. */
  plannedMin: number[];
  /** True when the collect floor forced a later start than promises allowed. */
  floorApplied: boolean;
  /** Minutes the final arrival slipped because of the floor. 0 when none. */
  slipMin: number;
};

/**
 * Rebuild a trip's stop times so every hop gets its real duration.
 *
 * The start is the earliest that ANY stop's promise demands — take the minimum
 * of `promised(i) - cumulativeTravel(i)` across all stops — then push forward
 * to the collect floor if one applies. Times are then laid out forward, so no
 * hop is ever scheduled in less time than the road needs.
 */
export function retimeStops(input: RetimeInput): RetimeResult {
  const { stops, hopMin, collectFloor } = input;
  if (stops.length === 0) return { plannedMin: [], floorApplied: false, slipMin: 0 };

  let start = Number.POSITIVE_INFINITY;
  let cumulative = 0;
  for (let i = 0; i < stops.length; i++) {
    if (i > 0) cumulative += hopMin[i] ?? 0;
    start = Math.min(start, stops[i].plannedMin - cumulative);
  }
  if (!Number.isFinite(start)) start = stops[0].plannedMin;

  const unpinnedEnd = start + cumulative;
  let floorApplied = false;
  if (collectFloor != null && start < collectFloor) {
    start = collectFloor;
    floorApplied = true;
  }

  const out: number[] = [];
  let cursor = start;
  for (let i = 0; i < stops.length; i++) {
    if (i > 0) cursor += hopMin[i] ?? 0;
    out.push(cursor);
  }

  return {
    plannedMin: out,
    floorApplied,
    slipMin: floorApplied ? out[out.length - 1] - unpinnedEnd : 0,
  };
}
