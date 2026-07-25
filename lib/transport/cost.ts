// Scoring and comparing two versions of a day's transport plan.
//
// Pure module (no imports) so the arithmetic is unit-tested rather than
// inferred from a board. Phase 2 of controlled lateness: before anything is
// allowed to make a passenger late, we have to be able to say precisely what
// the delay buys — and to compare that against the on-time plan it replaces.
//
// Two things live here:
//
//   planCost()    a single weighted number per plan, so alternatives can be
//                 ranked. Lateness is a PENALTY term, never a rejection: the
//                 hard limits belong to lib/transport/lateness.ts, and mixing
//                 the two would let a big saving buy its way past a policy.
//   comparePlans() the difference between an on-time plan and a delayed one,
//                 in the units an operations manager actually recognises —
//                 trips, vehicles, kilometres, empty kilometres, driver minutes.

/** What one candidate plan costs to run. */
export type PlanMetrics = {
  tripCount: number;
  vehicleCount: number;
  /** Total minutes of lateness across every affected passenger. */
  latenessMinutes: number;
  /** Passenger minutes spent waiting after being ready. */
  waitingMinutes: number;
  /** Passenger minutes spent in the vehicle. */
  journeyMinutes: number;
  /** Kilometres driven with nobody aboard. */
  emptyKm: number;
  totalKm: number;
  /** Paid driver minutes — the wage cost of the plan. */
  driverMinutes: number;
};

export const EMPTY_METRICS: PlanMetrics = {
  tripCount: 0,
  vehicleCount: 0,
  latenessMinutes: 0,
  waitingMinutes: 0,
  journeyMinutes: 0,
  emptyKm: 0,
  totalKm: 0,
  driverMinutes: 0,
};

/** How much each measure counts against a plan. Higher = more discouraged. */
export type OptimizationWeights = {
  tripCount: number;
  vehicleCount: number;
  latenessMinutes: number;
  waitingMinutes: number;
  journeyMinutes: number;
  emptyKm: number;
  totalKm: number;
};

/**
 * A starting point, not a truth. Trips and vehicles dominate because each one
 * is a real fixed cost; lateness is priced high enough that a delay has to save
 * something substantial to win, but not so high it can never win — that is what
 * the policy limits are for.
 */
export const DEFAULT_WEIGHTS: OptimizationWeights = {
  tripCount: 100,
  vehicleCount: 150,
  latenessMinutes: 8,
  waitingMinutes: 2,
  journeyMinutes: 1,
  emptyKm: 6,
  totalKm: 2,
};

/** The weighted cost of a plan. Lower is better. */
export function planCost(m: PlanMetrics, w: OptimizationWeights = DEFAULT_WEIGHTS): number {
  return (
    m.tripCount * w.tripCount +
    m.vehicleCount * w.vehicleCount +
    m.latenessMinutes * w.latenessMinutes +
    m.waitingMinutes * w.waitingMinutes +
    m.journeyMinutes * w.journeyMinutes +
    m.emptyKm * w.emptyKm +
    m.totalKm * w.totalKm
  );
}

/** What a delayed plan saves against the on-time one. Negative = it costs more. */
export type PlanComparison = {
  onTimeTripCount: number;
  proposedTripCount: number;
  tripsSaved: number;
  vehiclesSaved: number;
  kmSaved: number;
  emptyKmSaved: number;
  driverMinutesSaved: number;
  /** Total lateness the proposal introduces, in passenger-minutes. */
  latenessMinutes: number;
  onTimeCost: number;
  proposedCost: number;
  /** Positive when the proposal is cheaper overall on the weighted score. */
  costSaved: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Measure a delayed proposal against the on-time plan it would replace.
 *
 * Savings are reported as plain differences, including negative ones: a
 * proposal that saves a trip while adding kilometres should say so rather than
 * quietly reporting only its flattering numbers.
 */
export function comparePlans(
  onTime: PlanMetrics,
  proposed: PlanMetrics,
  w: OptimizationWeights = DEFAULT_WEIGHTS,
): PlanComparison {
  const onTimeCost = planCost(onTime, w);
  const proposedCost = planCost(proposed, w);
  return {
    onTimeTripCount: onTime.tripCount,
    proposedTripCount: proposed.tripCount,
    tripsSaved: onTime.tripCount - proposed.tripCount,
    vehiclesSaved: onTime.vehicleCount - proposed.vehicleCount,
    kmSaved: round1(onTime.totalKm - proposed.totalKm),
    emptyKmSaved: round1(onTime.emptyKm - proposed.emptyKm),
    driverMinutesSaved: Math.round(onTime.driverMinutes - proposed.driverMinutes),
    latenessMinutes: Math.round(proposed.latenessMinutes - onTime.latenessMinutes),
    onTimeCost: Math.round(onTimeCost),
    proposedCost: Math.round(proposedCost),
    costSaved: Math.round(onTimeCost - proposedCost),
  };
}

/** One measure worth telling a human about. */
export type SavingPart = { key: "trips" | "vehicles" | "km" | "emptyKm" | "driverMinutes"; value: number };

/**
 * The parts of a saving worth putting in a sentence — the positive ones, in
 * the order a person cares about. Returns data rather than prose so both
 * languages render from the same numbers.
 *
 * Feeds the summary the spec asks for:
 *   "Operational saving: 1 trip, 23 km and 38 driver minutes."
 */
export function savingParts(c: PlanComparison): SavingPart[] {
  const parts: SavingPart[] = [];
  if (c.tripsSaved > 0) parts.push({ key: "trips", value: c.tripsSaved });
  if (c.vehiclesSaved > 0) parts.push({ key: "vehicles", value: c.vehiclesSaved });
  if (c.kmSaved > 0) parts.push({ key: "km", value: c.kmSaved });
  if (c.emptyKmSaved > 0) parts.push({ key: "emptyKm", value: c.emptyKmSaved });
  if (c.driverMinutesSaved > 0) parts.push({ key: "driverMinutes", value: c.driverMinutesSaved });
  return parts;
}

/**
 * Is the proposal actually better on the weighted score?
 *
 * Separate from the policy thresholds on purpose. This asks "is it cheaper
 * once lateness is priced in"; lateness.ts asks "is it allowed at all". A
 * proposal must pass both, and neither can excuse the other.
 */
export function proposalIsCheaper(c: PlanComparison): boolean {
  return c.costSaved > 0;
}
