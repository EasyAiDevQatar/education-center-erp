// May this lesson be dragged, and if not, why not?
//
// Pure module (no imports beyond enum constants) so the answer is unit-tested
// rather than discovered when somebody moves an exam.
//
// Dragging is the first thing on this board that CHANGES something rather than
// showing it, so the question is not "is dragging enabled" but "is this
// particular block safe to move". The reasons differ in kind: a finished lesson
// cannot be moved because it already happened; an exam cannot be moved because
// sitting it late is not a trade worth any saving; a dispatched trip cannot be
// moved because a driver is already on the road with it. Collapsing those into
// one disabled state would leave the user guessing which rule they hit.

import { STRICT_SESSION_TYPES, type SessionType } from "@/lib/enums";

export type LockReason =
  /** Already taught, or being taught right now. */
  | "ALREADY_HAPPENED"
  /** An exam or assessment: never moved, whatever the settings say. */
  | "STRICT_TYPE"
  /** A driver is already on the road for it. */
  | "DISPATCHED"
  /** Clashes with another lesson, and the centre has chosen to lock those. */
  | "CONFLICTED"
  /** Older than the centre allows anyone to reach back and change. */
  | "TOO_OLD"
  /** This user may look but not move. */
  | "NOT_PERMITTED";

export type DragSubject = {
  status: string;
  sessionType: SessionType;
  /** True when this lesson collides with another in the same day. */
  conflicts: boolean;
  /** True when a trip serving it has left the proposed stage. */
  tripDispatched: boolean;
  /**
   * Whole days between the lesson and now. Zero today, negative in the future.
   *
   * The clock, not the status column. A lesson dated next week and marked
   * COMPLETED is bad data, not history, and refusing to move it because it
   * "already happened" is the board repeating an error back as a rule.
   */
  daysOld: number;
};

export type DragPolicy = {
  /** May this user move anything at all? */
  canDrag: boolean;
  /**
   * How far back the centre allows a day to be corrected, in days.
   *
   * Records get fixed after the fact — a lesson ran long, someone was marked
   * absent by mistake, a ride was logged to the wrong driver. Freezing the
   * past the instant it happens makes the system a worse record than the
   * paper it replaced. Freezing it never makes last term's books editable.
   */
  graceDays: number;
  /** The centre's choice: lock a clashing lesson, or allow it to be dragged. */
  lockConflicted: boolean;
};

/** Statuses that stop being a plan whatever the clock says. */
const ABANDONED = new Set(["CANCELLED", "NO_SHOW"]);

/**
 * Why this lesson cannot be dragged, or null when it can.
 *
 * Order matters: the most fundamental reason wins, so a completed exam reads
 * as "already happened" rather than "exams are strict" — the first is why it
 * is truly immovable, the second merely a policy that no longer applies.
 */
export function lockReasonFor(
  subject: DragSubject,
  policy: DragPolicy,
): LockReason | null {
  if (!policy.canDrag) return "NOT_PERMITTED";
  // Old enough that changing it would be rewriting the record rather than
  // correcting it. Checked before everything else: no other reason matters
  // once the day is closed.
  if (subject.daysOld > policy.graceDays) return "TOO_OLD";
  if (ABANDONED.has(subject.status)) return "ALREADY_HAPPENED";
  if (STRICT_SESSION_TYPES.includes(subject.sessionType)) return "STRICT_TYPE";
  if (subject.tripDispatched) return "DISPATCHED";
  if (subject.conflicts && policy.lockConflicted) return "CONFLICTED";
  return null;
}

/** Convenience: can this be picked up at all? */
export function isDraggable(subject: DragSubject, policy: DragPolicy): boolean {
  return lockReasonFor(subject, policy) === null;
}

/**
 * Snap a dragged minute to the grid the office actually books on.
 *
 * Quarter hours, because a lesson at 16:07 is not a thing anybody wants and
 * a free-running drag produces one on every gesture.
 */
export function snapMinutes(minute: number, stepMin = 15): number {
  return Math.round(minute / stepMin) * stepMin;
}

/**
 * Where a drag would put a lesson, given how far it moved across the axis.
 *
 * Clamped to the axis so a lesson cannot be flung off either end, and the
 * duration is preserved — dragging moves a lesson, it does not resize it.
 */
export function proposedTimes(
  original: { startMin: number; endMin: number },
  deltaMin: number,
  axis: { minMin: number; maxMin: number },
  stepMin = 15,
): { startMin: number; endMin: number } {
  const duration = original.endMin - original.startMin;
  const raw = snapMinutes(original.startMin + deltaMin, stepMin);
  const startMin = Math.min(Math.max(raw, axis.minMin), axis.maxMin - duration);
  return { startMin, endMin: startMin + duration };
}

/**
 * Where a RESIZE would put a lesson's edges.
 *
 * Sibling of `proposedTimes`, which deliberately preserves duration. Here the
 * opposite invariant holds: one edge is pinned and the other moves, so a drag
 * on the earlier edge changes when a lesson starts without moving when it ends.
 *
 * The 15-minute snap is what keeps the result expressible: hours land on exact
 * quarters, so the client can never draw a duration the booking schema would
 * reject.
 */
export function proposedResize(
  original: { startMin: number; endMin: number },
  edge: "from" | "to",
  deltaMin: number,
  axis: { minMin: number; maxMin: number },
  opts: { stepMin?: number; minDurationMin?: number; maxDurationMin?: number } = {},
): { startMin: number; endMin: number } {
  const step = opts.stepMin ?? 15;
  const min = Math.max(step, opts.minDurationMin ?? 15);
  const max = opts.maxDurationMin ?? 12 * 60;

  if (edge === "to") {
    const raw = snapMinutes(original.endMin + deltaMin, step);
    const endMin = Math.min(
      Math.max(raw, original.startMin + min),
      Math.min(axis.maxMin, original.startMin + max),
    );
    return { startMin: original.startMin, endMin };
  }

  const raw = snapMinutes(original.startMin + deltaMin, step);
  const startMin = Math.min(
    Math.max(raw, Math.max(axis.minMin, original.endMin - max)),
    original.endMin - min,
  );
  return { startMin, endMin: original.endMin };
}

/** Minutes → hours, in the exact quarters the booking schema accepts. */
export function hoursOf(startMin: number, endMin: number): number {
  return Math.round(((endMin - startMin) / 60) * 100) / 100;
}
