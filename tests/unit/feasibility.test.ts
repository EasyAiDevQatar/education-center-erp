import { describe, it, expect } from "vitest";
import {
  legFeasibility,
  overlappingSessions,
  uncoveredMinutes,
  type SessionWindow,
} from "@/lib/transport/feasibility";

const w = (label: string, startMin: number, endMin: number): SessionWindow => ({
  sessionId: label,
  label,
  startMin,
  endMin,
});

/**
 * حنان's real day, 2026-07-25 — the one that looked like six hours of idling.
 * The home lesson and the first centre lesson overlap by 30 minutes.
 */
const HANAN = [
  w("راشد (home)", 14 * 60, 15 * 60 + 30),
  w("فهد (centre)", 15 * 60, 17 * 60),
  w("منيره (centre)", 17 * 60, 18 * 60),
  w("محمد (centre)", 18 * 60, 19 * 60 + 30),
];

describe("overlappingSessions", () => {
  it("finds the double booking in a real day", () => {
    const clashes = overlappingSessions(HANAN);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].a.label).toBe("راشد (home)");
    expect(clashes[0].b.label).toBe("فهد (centre)");
    expect(clashes[0].overlapMin).toBe(30);
  });

  it("treats back-to-back lessons as fine, not overlapping", () => {
    expect(overlappingSessions([w("a", 600, 660), w("b", 660, 720)])).toEqual([]);
  });

  it("reports every colliding pair, not just the first", () => {
    const all = overlappingSessions([w("a", 600, 720), w("b", 610, 700), w("c", 615, 690)]);
    expect(all).toHaveLength(3);
  });

  it("says nothing about a clear day", () => {
    expect(overlappingSessions([w("a", 600, 660), w("b", 700, 760)])).toEqual([]);
  });
});

describe("legFeasibility", () => {
  it("names an inverted window instead of blaming the fleet", () => {
    // حنان: free at 15:40 after the home lesson, due at the centre by 14:55.
    const f = legFeasibility({ readyMin: 15 * 60 + 40, dueMin: 14 * 60 + 55 });
    expect(f.possible).toBe(false);
    expect(f.reason).toBe("windowInverted");
    expect(f.shortfallMin).toBe(45);
  });

  it("accepts a tight but real window", () => {
    expect(legFeasibility({ readyMin: 900, dueMin: 905 }).possible).toBe(true);
  });

  it("accepts a window with nothing to spare", () => {
    expect(legFeasibility({ readyMin: 900, dueMin: 900 }).possible).toBe(true);
  });

  it("reports a missing pin separately from a timing problem", () => {
    const f = legFeasibility({ readyMin: 600, dueMin: 700, hasTo: false });
    expect(f.reason).toBe("missingLocation");
  });
});

describe("uncoveredMinutes", () => {
  it("reports no idle time across a fully taught afternoon", () => {
    // 13:45 dropped, 19:42 collected — six hours that were all lessons.
    // Only the 14:00 start and the 19:30 finish are genuinely uncovered.
    const idle = uncoveredMinutes(HANAN, 13 * 60 + 45, 19 * 60 + 42);
    expect(idle).toBe(15 + 12); // before the first lesson, after the last
  });

  it("counts a real hole between two lessons", () => {
    const idle = uncoveredMinutes([w("a", 600, 660), w("b", 780, 840)], 600, 840);
    expect(idle).toBe(120);
  });

  it("does not double-count overlapping lessons", () => {
    const idle = uncoveredMinutes([w("a", 600, 700), w("b", 650, 720)], 600, 720);
    expect(idle).toBe(0);
  });

  it("is zero for an empty or inverted range", () => {
    expect(uncoveredMinutes(HANAN, 900, 900)).toBe(0);
    expect(uncoveredMinutes(HANAN, 900, 800)).toBe(0);
  });
});
