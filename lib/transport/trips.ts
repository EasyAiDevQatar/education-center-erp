// Trip identity and lifecycle rules.
//
// Pure module — no imports, no DB — so the two rules that decide whether the
// planner is trustworthy are unit-tested:
//   1. re-running the generator must refresh the board, never duplicate it;
//   2. a trip can only move between states that make operational sense.

import type { TripStatus } from "../enums";

/**
 * Stable identity for the ride a generated trip serves.
 *
 * Deliberately built from the *sessions* either side rather than the leg's
 * position in the day: adding an early-morning lesson shifts every later leg's
 * index, and an index-based key would then duplicate the whole day's board.
 * `home` stands in for the open end of the first pickup and last drop-off.
 */
export function legKeyFor(leg: {
  passengerKind: string;
  passengerId: string;
  fromSessionId: string | null;
  toSessionId: string | null;
}): string {
  return [
    leg.passengerKind,
    leg.passengerId,
    leg.fromSessionId ?? "home",
    leg.toSessionId ?? "home",
  ].join(":");
}

/**
 * Allowed status moves. Everything not listed is refused, so a stale browser
 * tab cannot complete a trip that was cancelled ten minutes ago.
 */
const TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  // A proposal is the generator's suggestion: approve it or throw it away.
  PROPOSED: ["ASSIGNED", "CANCELLED"],
  // A manually created trip still needs a driver before it can start.
  PLANNED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["STARTED", "CANCELLED"],
  STARTED: ["COMPLETED", "CANCELLED"],
  // Terminal: a completed trip is a record of something that happened.
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: TripStatus, to: TripStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function nextStatuses(from: TripStatus): TripStatus[] {
  return [...(TRANSITIONS[from] ?? [])];
}

/** A trip still in play — what the planner board and the driver app care about. */
export function isOpen(status: TripStatus): boolean {
  return status !== "COMPLETED" && status !== "CANCELLED";
}

/**
 * Trips the generator owns. It refreshes its own untouched proposals and must
 * never rewrite a trip a human has already approved, started or cancelled —
 * that would silently undo a dispatcher's decision.
 */
export function generatorMayReplace(status: TripStatus): boolean {
  return status === "PROPOSED";
}
