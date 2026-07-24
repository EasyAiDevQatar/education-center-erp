// Driver allocation: which driver takes which ride.
//
// Pure module — depends only on the sibling eta.ts. This is the module the
// whole transport feature exists for, so every rule here is unit-tested.
//
// Strategy: earliest-deadline-first greedy with a scored driver choice.
// A ride whose deadline is soonest is placed first (it has the least freedom),
// and among the drivers who *can* make it we take the cheapest by a small
// weighted score. This is not an optimal VRP solution and is not trying to be:
// it runs instantly, every choice can be explained to the coordinator in terms
// they recognise (empty km and fairness), and a human approves the board
// afterwards.
//
// The one rule that matters more than efficiency: a ride nobody can make is
// NEVER silently dropped. It comes back in `unassigned` with a reason, because
// the real-world consequence is a teacher stranded at a stranger's house.

import { travelMinutes, type SpeedProfile } from "./eta";

export type LatLng = { lat: number; lng: number };

export type AllocLeg = {
  id: string;
  from: LatLng;
  to: LatLng;
  /** Earliest the passenger can be collected (minutes from midnight). */
  readyMin: number;
  /** Latest they must arrive. */
  dueMin: number;
  /** Seats needed (a shared ride for two students needs two). */
  passengers: number;
};

export type AllocDriver = {
  id: string;
  /** Where the driver starts the day. */
  startAt: LatLng;
  /** Minute the driver becomes available (shift start, or now). */
  freeFromMin: number;
  /** Vehicle seats. */
  capacity: number;
  shiftStartMin?: number | null;
  shiftEndMin?: number | null;
};

export type Assignment = {
  legId: string;
  driverId: string;
  /** When the driver leaves for the pickup. */
  departMin: number;
  /** When the passenger is collected. */
  pickupMin: number;
  /** When they are delivered. */
  dropoffMin: number;
  /** Empty kilometres driven to reach the pickup. */
  deadheadKm: number;
  /** Minutes the driver sits idle between their last drop-off and departing.
      Reported for the board, deliberately NOT scored: an unused driver has a
      huge idle figure by definition, and scoring it hands work to whoever is
      already busiest. */
  idleMin: number;
  /** Spare minutes before the deadline. Small = tight. */
  slackMin: number;
  /** Lower is better; recorded so the UI can explain the choice. */
  score: number;
};

export type UnassignedReason =
  | "tooLate"
  | "noCapacity"
  | "outsideShift"
  | "tooFar"
  | "noDriver";

export type Unassigned = { legId: string; reason: UnassignedReason };

export type AllocOptions = {
  /** Straight-line km between two points. Injected so this module stays pure. */
  distanceKm: (a: LatLng, b: LatLng) => number;
  /** Grace minutes a delivery may overrun its deadline before it's infeasible. */
  graceMin?: number;
  /** Refuse a pickup further than this in empty km. */
  maxDeadheadKm?: number;
  /** Score weights. */
  weights?: { emptyKm?: number; loadMin?: number };
  /**
   * Real road minutes between two points, when a routing service is available.
   *
   * Without this the allocator plans on straight-line km ÷ configured speed
   * while the trip is later built and validated against actual road times — so
   * the two disagree, in both directions. Too optimistic a speed and every trip
   * is born late; too pessimistic and rides the road does comfortably are
   * rejected as impossible. Returning null falls back to the estimate.
   */
  travelMin?: (a: LatLng, b: LatLng, departMin: number) => number | null;
};

type DriverRuntime = AllocDriver & {
  at: LatLng;
  freeAt: number;
  /** Total minutes already committed — the fairness term. */
  loadMin: number;
};

const DEFAULT_WEIGHTS = { emptyKm: 1, loadMin: 0.02 };

/**
 * Allocate legs to drivers.
 *
 * Deterministic: legs are processed by (deadline, id) and ties between equally
 * scored drivers break on driver id, so the same input always produces the same
 * board. A coordinator who re-runs the planner must not see the plan reshuffle.
 */
export function allocate(
  legs: AllocLeg[],
  drivers: AllocDriver[],
  profile: SpeedProfile,
  opts: AllocOptions,
): { assignments: Assignment[]; unassigned: Unassigned[] } {
  const {
    distanceKm,
    graceMin = 0,
    maxDeadheadKm = Number.POSITIVE_INFINITY,
    weights,
    travelMin,
  } = opts;
  const w = { ...DEFAULT_WEIGHTS, ...(weights ?? {}) };

  /** Road minutes when routing knows the answer, else the speed estimate. */
  const hopMinutes = (a: LatLng, b: LatLng, km: number, departMin: number) =>
    travelMin?.(a, b, departMin) ?? travelMinutes(km, departMin, profile);

  const runtime: DriverRuntime[] = drivers.map((d) => ({
    ...d,
    at: d.startAt,
    freeAt: Math.max(d.freeFromMin, d.shiftStartMin ?? d.freeFromMin),
    loadMin: 0,
  }));

  const ordered = [...legs].sort(
    (a, b) => a.dueMin - b.dueMin || a.id.localeCompare(b.id),
  );

  const assignments: Assignment[] = [];
  const unassigned: Unassigned[] = [];

  for (const leg of ordered) {
    if (runtime.length === 0) {
      unassigned.push({ legId: leg.id, reason: "noDriver" });
      continue;
    }

    let best: { driver: DriverRuntime; a: Assignment } | null = null;
    // Remember why every driver failed, so the reason we report is the most
    // informative one rather than a blanket "no driver".
    let sawCapacity = false;
    let sawShift = false;
    let sawFar = false;
    let sawLate = false;

    for (const d of runtime) {
      if (d.capacity < leg.passengers) {
        sawCapacity = true;
        continue;
      }

      const deadheadKm = distanceKm(d.at, leg.from);
      if (deadheadKm > maxDeadheadKm) {
        sawFar = true;
        continue;
      }

      const deadheadMin = hopMinutes(d.at, leg.from, deadheadKm, d.freeAt);
      // Leave just in time, not the instant the driver is free. Without this a
      // driver idle since shift start looks expensive purely for being idle,
      // which inverts the fairness term and hands the whole day to whoever was
      // busiest. Departing late is also what a real driver does.
      const departMin = Math.max(d.freeAt, leg.readyMin - deadheadMin);
      const arriveAtPickup = departMin + deadheadMin;
      const pickupMin = Math.max(leg.readyMin, arriveAtPickup);
      const rideKm = distanceKm(leg.from, leg.to);
      const rideMin = hopMinutes(leg.from, leg.to, rideKm, pickupMin);
      const dropoffMin = pickupMin + rideMin;

      if (dropoffMin > leg.dueMin + graceMin) {
        sawLate = true;
        continue;
      }
      if (d.shiftEndMin != null && dropoffMin > d.shiftEndMin) {
        sawShift = true;
        continue;
      }

      // Just-in-time departure means the driver never waits at the pickup;
      // what is left is idle time before they set off.
      const idleMin = Math.max(0, departMin - d.freeAt);
      const score = deadheadKm * w.emptyKm + d.loadMin * w.loadMin;

      const candidate: Assignment = {
        legId: leg.id,
        driverId: d.id,
        departMin,
        pickupMin,
        dropoffMin,
        deadheadKm: Math.round(deadheadKm * 100) / 100,
        idleMin,
        slackMin: leg.dueMin - dropoffMin,
        score: Math.round(score * 1000) / 1000,
      };

      if (
        !best ||
        candidate.score < best.a.score ||
        // Deterministic tie-break.
        (candidate.score === best.a.score && d.id < best.driver.id)
      ) {
        best = { driver: d, a: candidate };
      }
    }

    if (!best) {
      const reason: UnassignedReason = sawLate
        ? "tooLate"
        : sawCapacity
          ? "noCapacity"
          : sawShift
            ? "outsideShift"
            : sawFar
              ? "tooFar"
              : "noDriver";
      unassigned.push({ legId: leg.id, reason });
      continue;
    }

    assignments.push(best.a);
    best.driver.at = leg.to;
    best.driver.freeAt = best.a.dropoffMin;
    best.driver.loadMin += best.a.dropoffMin - best.a.departMin;
  }

  return { assignments, unassigned };
}
