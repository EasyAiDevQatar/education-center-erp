import { describe, it, expect } from "vitest";
import {
  DEFAULT_SPACING,
  overlaps,
  requiredGapMin,
  spacingProblem,
  spacingProblems,
  suggestStart,
  type SpacedSession,
} from "@/lib/transport/spacing";

const H = (h: number, m = 0) => h * 60 + m;
const centre = (a: number, b: number, id = "c"): SpacedSession => ({ id, startMin: a, endMin: b, location: "CENTER" });
const home = (a: number, b: number, id = "h"): SpacedSession => ({ id, startMin: a, endMin: b, location: "HOME" });

describe("overlaps", () => {
  it("treats touching lessons as not overlapping", () => {
    // 16:00-17:00 then 17:00-18:00 is a normal back-to-back afternoon.
    expect(overlaps(centre(H(16), H(17)), centre(H(17), H(18)))).toBe(false);
  });

  it("catches the shape the office keeps booking", () => {
    // 16:00-17:30 and 17:00-18:00 — the case reported as "currently happening".
    expect(overlaps(centre(H(16), H(17, 30)), centre(H(17), H(18)))).toBe(true);
  });
});

describe("requiredGapMin", () => {
  it("asks for nothing between two centre lessons — a corridor is not a journey", () => {
    expect(requiredGapMin(centre(H(16), H(17)), centre(H(17), H(18)))).toBe(0);
  });

  it("reserves the buffer whenever a house is involved", () => {
    expect(requiredGapMin(home(H(14), H(15)), centre(H(15), H(16)))).toBe(15);
    expect(requiredGapMin(centre(H(14), H(15)), home(H(15), H(16)))).toBe(15);
    expect(requiredGapMin(home(H(14), H(15)), home(H(15), H(16)))).toBe(15);
  });

  it("honours a configured buffer", () => {
    expect(requiredGapMin(home(H(14), H(15)), centre(H(16), H(17)), { ...DEFAULT_SPACING, homeBufferMin: 25 })).toBe(25);
  });
});

describe("spacingProblem — two centre lessons", () => {
  it("allows back-to-back", () => {
    expect(spacingProblem(centre(H(16), H(17), "a"), centre(H(17), H(18), "b"))).toBeNull();
  });

  it("rejects 16:00-17:30 against 17:00-18:00", () => {
    const p = spacingProblem(centre(H(16), H(17, 30), "a"), centre(H(17), H(18), "b"));
    expect(p?.kind).toBe("OVERLAP");
    expect(p?.actualGapMin).toBe(-30);
    expect(p?.shortfallMin).toBe(30);
  });

  it("does not care which order it is given", () => {
    const a = spacingProblem(centre(H(16), H(17, 30), "a"), centre(H(17), H(18), "b"));
    const b = spacingProblem(centre(H(17), H(18), "b"), centre(H(16), H(17, 30), "a"));
    expect(a?.kind).toBe(b?.kind);
    expect(a?.actualGapMin).toBe(b?.actualGapMin);
  });
});

describe("spacingProblem — حنان's real double booking, 2026-07-25", () => {
  // 14:00-15:30 at a student's house, then 15:00-17:00 at the centre. This is
  // the booking that produced a leg the planner could never drive.
  const houseVisit = home(H(14), H(15, 30), "raashid");
  const centreLesson = centre(H(15), H(17), "fahd");

  it("is caught as an overlap", () => {
    expect(spacingProblem(houseVisit, centreLesson)?.kind).toBe("OVERLAP");
  });

  it("reports how much room is missing, including the journey", () => {
    const p = spacingProblem(houseVisit, centreLesson)!;
    expect(p.actualGapMin).toBe(-30); // starts 30 min before the first ends
    expect(p.requiredGapMin).toBe(15); // plus a journey
    expect(p.shortfallMin).toBe(45); // 45 minutes short in total
  });

  it("would still be caught with no overlap at all, if merely tight", () => {
    // Ends 15:30, next starts 15:35: no overlap, but nobody drives it in 5 min.
    const p = spacingProblem(houseVisit, centre(H(15, 35), H(17), "fahd"))!;
    expect(p.kind).toBe("TOO_TIGHT");
    expect(p.shortfallMin).toBe(10);
  });
});

describe("suggestStart", () => {
  const day = [centre(H(16), H(17), "existing")];

  it("suggests 16:15 for a home visit booked at 16:00", () => {
    // The worked example: booking 16:00 after a centre lesson ending 16:00...
    const suggested = suggestStart(home(H(16), H(17), "new"), [centre(H(15), H(16), "before")]);
    expect(suggested).toBe(H(16, 15));
  });

  it("leaves a clean booking exactly where it was asked for", () => {
    expect(suggestStart(centre(H(17), H(18), "new"), day)).toBe(H(17));
  });

  it("moves forward, never earlier", () => {
    const suggested = suggestStart(centre(H(16), H(17), "new"), day)!;
    expect(suggested).toBeGreaterThanOrEqual(H(16));
    expect(suggested).toBe(H(17)); // straight after the existing lesson
  });

  it("clears a house visit past the whole buffer", () => {
    expect(suggestStart(home(H(16), H(17), "new"), day)).toBe(H(17, 15));
  });

  it("gives up rather than suggesting something absurd", () => {
    const packed = Array.from({ length: 20 }, (_, i) =>
      centre(H(8) + i * 60, H(9) + i * 60, `x${i}`),
    );
    expect(suggestStart(home(H(8), H(9), "new"), packed, DEFAULT_SPACING, { maxSearchMin: 60 })).toBeNull();
  });
});

describe("spacingProblems", () => {
  it("never reports a lesson against itself when it is being moved", () => {
    const existing = [centre(H(16), H(17), "same"), centre(H(18), H(19), "other")];
    expect(spacingProblems(centre(H(16), H(17), "same"), existing)).toEqual([]);
  });

  it("reports every clash, not just the first", () => {
    const existing = [centre(H(16), H(17), "a"), centre(H(16, 30), H(17, 30), "b")];
    expect(spacingProblems(centre(H(16, 15), H(17, 15), "new"), existing)).toHaveLength(2);
  });
});
