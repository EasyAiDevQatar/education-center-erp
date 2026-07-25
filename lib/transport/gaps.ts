// What is this person doing when nothing is scheduled?
//
// Pure module (no imports) so the rules are unit-tested rather than eyeballed
// on a board. This is the piece that makes a blank stretch mean something.
//
// The board previously drew lessons and rides and left everything between them
// empty, which is how a teacher who taught continuously for six hours looked
// idle. Filling the gaps is only half the fix: an empty stretch between two
// lessons in the SAME place is a person waiting, while the same stretch between
// two lessons in DIFFERENT places is a journey nobody planned — the second is a
// defect and the first is just a quiet afternoon. Calling both "free" would put
// the missing ride back out of sight, which is the bug this planner exists to
// stop.

/** A lesson or a ride the person is already committed to. */
export type Commitment = {
  id: string;
  startMin: number;
  endMin: number;
  /** LESSON_HOME | LESSON_CENTRE | TRIP */
  kind: CommitmentKind;
};

export type CommitmentKind = "LESSON_HOME" | "LESSON_CENTRE" | "TRIP";

export type GapKind =
  /** Between two lessons in different places, with no ride booked. */
  | "TRAVEL_NOT_PLANNED"
  /** Idle at the centre between commitments there. */
  | "WAITING"
  /** Genuinely nothing on — before the day starts or after it ends. */
  | "FREE";

export type ClassifiedGap = {
  startMin: number;
  endMin: number;
  kind: GapKind;
  /**
   * True when this gap should be drawn as a problem rather than merely shown.
   * A journey nobody planned is always a problem; waiting only becomes one past
   * the limit the validator already enforces, so the board and the validator
   * agree instead of inventing a second threshold.
   */
  problem: boolean;
  /** What the person was doing immediately before the gap, when known. */
  afterKind: CommitmentKind | null;
  /** What they are due to do immediately after it, when known. */
  beforeKind: CommitmentKind | null;
};

const durationOf = (g: { startMin: number; endMin: number }) => g.endMin - g.startMin;

/** Where a commitment physically leaves the person. Null while in transit. */
function placeOf(k: CommitmentKind): "HOME" | "CENTRE" | null {
  if (k === "LESSON_HOME") return "HOME";
  if (k === "LESSON_CENTRE") return "CENTRE";
  return null; // a trip ends wherever it was going; the next commitment says where
}

/**
 * Classify every uncovered stretch between a person's commitments.
 *
 * Only the interior is classified — the day is bounded by its first and last
 * commitment, because time before someone's first lesson is not a gap in their
 * day, it is simply not their day yet.
 *
 * Overlapping commitments (a double booking) produce no gap between them, by
 * construction: they are merged before the gaps are read off. The overlap
 * itself is reported separately by overlappingSessions() in feasibility.ts —
 * one module per question.
 */
export function classifyGaps(
  commitments: readonly Commitment[],
  opts: { maxWaitMin: number },
): ClassifiedGap[] {
  const sorted = [...commitments]
    .filter((c) => c.endMin > c.startMin)
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  if (sorted.length < 2) return [];

  const gaps: ClassifiedGap[] = [];

  // Sweep forward keeping the furthest point reached so far. Using the running
  // maximum rather than the previous item's end is what stops a long lesson
  // that swallows a short one from reporting a phantom gap after it.
  let reach = sorted[0].endMin;
  let reachedBy = sorted[0].kind;

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];

    if (next.startMin > reach) {
      const afterKind = reachedBy;
      const beforeKind = next.kind;
      const from = placeOf(afterKind);
      const to = placeOf(beforeKind);

      // Two lessons in different places and nothing booked between them: the
      // person cannot be in both, so a ride is missing. This is the case that
      // was invisible — the leg the planner refused, showing as blank space.
      const mustMove = from !== null && to !== null && from !== to;

      // A gap touching a ride is time spent AT a place, waiting: dropped off
      // early and waiting to start, or finished and waiting to be collected.
      // Calling that "free" reads as though the person could go somewhere,
      // when in fact they are sitting at a student's door.
      const touchesRide = afterKind === "TRIP" || beforeKind === "TRIP";

      const kind: GapKind = mustMove
        ? "TRAVEL_NOT_PLANNED"
        : touchesRide || from === "CENTRE" || to === "CENTRE"
          ? "WAITING"
          : "FREE";

      const gap = { startMin: reach, endMin: next.startMin, kind, afterKind, beforeKind };
      gaps.push({
        ...gap,
        problem: kind === "TRAVEL_NOT_PLANNED" || (kind === "WAITING" && durationOf(gap) > opts.maxWaitMin),
      });
    }

    if (next.endMin > reach) {
      reach = next.endMin;
      reachedBy = next.kind;
    }
  }

  return gaps;
}

/** Total minutes across gaps, optionally only the ones flagged as problems. */
export function gapMinutes(gaps: readonly ClassifiedGap[], onlyProblems = false): number {
  return gaps
    .filter((g) => !onlyProblems || g.problem)
    .reduce((acc, g) => acc + durationOf(g), 0);
}
