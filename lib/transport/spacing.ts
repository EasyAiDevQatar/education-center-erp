// How much room two of one teacher's lessons need between them.
//
// Pure module (no imports) so the rule is unit-tested rather than discovered
// when a teacher is booked into two places at once.
//
// The existing conflict check (lib/conflicts.ts) asks "do these overlap?", and
// answers advisorily — the office is allowed to double-book and sort it out.
// That is the right call for two lessons at the CENTRE, where a teacher walks
// between rooms. It is the wrong call the moment a HOME visit is involved:
// nobody can finish at a student's house at 15:00 and start at the centre at
// 15:00, and the planner cannot invent a car that teleports. The overlap is
// then not a scheduling preference, it is a leg that can never be driven —
// which is exactly how this codebase produced trips that were impossible
// before any driver was considered.
//
// So this module answers a different question: not "do they overlap" but
// "is there ENOUGH ROOM", where enough depends on whether anyone has to travel.

export type SpacedSession = {
  id?: string | null;
  startMin: number;
  endMin: number;
  /** CENTER | HOME */
  location: string;
};

export type SpacingConfig = {
  /**
   * Minutes to reserve around a HOME visit for the journey. Not the journey
   * itself — the planner computes that from the road network — but the floor
   * below which no journey could ever fit.
   */
  homeBufferMin: number;
  /**
   * Whether two CENTRE lessons may run back-to-back with no gap. They may: the
   * teacher walks down a corridor. They may NOT overlap.
   */
  centreBackToBack: boolean;
};

export const DEFAULT_SPACING: SpacingConfig = {
  homeBufferMin: 15,
  centreBackToBack: true,
};

/** Do these two occupy the same clock time at all? */
export function overlaps(a: SpacedSession, b: SpacedSession): boolean {
  // Half-open: 16:00-17:00 and 17:00-18:00 touch, they do not overlap.
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/**
 * The gap one teacher needs between these two lessons.
 *
 * Zero for two lessons at the centre — a corridor is not a journey. The home
 * buffer whenever either end is a house, because somebody has to drive.
 */
export function requiredGapMin(
  a: SpacedSession,
  b: SpacedSession,
  cfg: SpacingConfig = DEFAULT_SPACING,
): number {
  const involvesHome = a.location === "HOME" || b.location === "HOME";
  if (!involvesHome) return cfg.centreBackToBack ? 0 : cfg.homeBufferMin;
  return Math.max(0, cfg.homeBufferMin);
}

export type SpacingProblem = {
  kind: "OVERLAP" | "TOO_TIGHT";
  /** Minutes actually between them. Negative when they overlap. */
  actualGapMin: number;
  requiredGapMin: number;
  /** How much more room is needed. */
  shortfallMin: number;
  /** The other lesson, for the message. */
  otherId?: string | null;
};

/**
 * Is there room between these two? Null when there is.
 *
 * Order-independent: the caller should not have to know which came first.
 */
export function spacingProblem(
  a: SpacedSession,
  b: SpacedSession,
  cfg: SpacingConfig = DEFAULT_SPACING,
): SpacingProblem | null {
  const [first, second] = a.startMin <= b.startMin ? [a, b] : [b, a];
  const need = requiredGapMin(first, second, cfg);
  const actual = second.startMin - first.endMin;

  if (overlaps(a, b)) {
    return {
      kind: "OVERLAP",
      actualGapMin: actual,
      requiredGapMin: need,
      shortfallMin: need - actual,
      otherId: first.id === a.id ? b.id : a.id,
    };
  }
  if (actual < need) {
    return {
      kind: "TOO_TIGHT",
      actualGapMin: actual,
      requiredGapMin: need,
      shortfallMin: need - actual,
      otherId: first.id === a.id ? b.id : a.id,
    };
  }
  return null;
}

/** Every problem a candidate has against a teacher's existing day. */
export function spacingProblems(
  candidate: SpacedSession,
  existing: readonly SpacedSession[],
  cfg: SpacingConfig = DEFAULT_SPACING,
): SpacingProblem[] {
  return existing
    .filter((e) => !candidate.id || e.id !== candidate.id)
    .map((e) => spacingProblem(candidate, e, cfg))
    .filter((p): p is SpacingProblem => p !== null);
}

/**
 * The nearest start time that clears every problem, searching FORWARD.
 *
 * Forward only, and in whole steps, because that is what an office does: a
 * lesson booked for 16:00 that cannot fit becomes 16:15, not 15:45 — moving it
 * earlier collides with whatever the teacher was already doing and surprises a
 * parent who was told an afternoon slot. Returns null when the day cannot take
 * it at all, rather than suggesting something absurd.
 */
export function suggestStart(
  candidate: SpacedSession,
  existing: readonly SpacedSession[],
  cfg: SpacingConfig = DEFAULT_SPACING,
  opts: { stepMin?: number; maxSearchMin?: number } = {},
): number | null {
  const step = opts.stepMin ?? 5;
  const limit = opts.maxSearchMin ?? 8 * 60;
  const duration = candidate.endMin - candidate.startMin;

  for (let delta = 0; delta <= limit; delta += step) {
    const start = candidate.startMin + delta;
    const probe: SpacedSession = {
      id: candidate.id,
      startMin: start,
      endMin: start + duration,
      location: candidate.location,
    };
    if (spacingProblems(probe, existing, cfg).length === 0) {
      return start;
    }
  }
  return null;
}
