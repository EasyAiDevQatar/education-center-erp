import { describe, it, expect } from "vitest";
import {
  suggestNextStart,
  compactTimes,
  hhmmToMin,
  minToHHMM,
  PLANNER_MAX,
} from "@/lib/planner";

const DAY_START = 14 * 60; // 14:00
const HOME_GAP = 30;

describe("suggestNextStart", () => {
  it("uses the day start when the teacher has no sessions", () => {
    expect(
      suggestNextStart({ existing: [], dayStartMin: DAY_START, homeGapMin: HOME_GAP, nextLocation: "CENTER" }),
    ).toBe(DAY_START);
  });

  it("chains after the latest existing session end", () => {
    // 14:00–15:00 then 15:00–16:30 → next starts 16:30
    const existing = [
      { startMin: 14 * 60, hours: 1 },
      { startMin: 15 * 60, hours: 1.5 },
    ];
    expect(
      suggestNextStart({ existing, dayStartMin: DAY_START, homeGapMin: HOME_GAP, nextLocation: "CENTER" }),
    ).toBe(16 * 60 + 30);
  });

  it("adds the travel gap before a HOME session", () => {
    const existing = [{ startMin: 16 * 60, hours: 1 }]; // ends 17:00
    expect(
      suggestNextStart({ existing, dayStartMin: DAY_START, homeGapMin: HOME_GAP, nextLocation: "HOME" }),
    ).toBe(17 * 60 + 30);
  });

  it("clamps to the planner window", () => {
    const existing = [{ startMin: 22 * 60 + 30, hours: 2 }]; // ends past 23:00
    expect(
      suggestNextStart({ existing, dayStartMin: DAY_START, homeGapMin: 0, nextLocation: "CENTER" }),
    ).toBe(PLANNER_MAX);
  });
});

describe("compactTimes", () => {
  it("re-chains gapped drafts from the anchor", () => {
    // Drafts at 14:00 (1h) and 17:00 (1h) with a 2h gap → 14:00 then 15:00.
    const out = compactTimes({
      drafts: [
        { id: "a", startMin: 14 * 60, hours: 1, location: "CENTER" },
        { id: "b", startMin: 17 * 60, hours: 1, location: "CENTER" },
      ],
      fixed: [],
      anchorMin: 14 * 60,
      homeGapMin: HOME_GAP,
    });
    expect(out).toEqual([
      { id: "a", startMin: 14 * 60 },
      { id: "b", startMin: 15 * 60 },
    ]);
  });

  it("inserts the travel gap before HOME drafts", () => {
    const out = compactTimes({
      drafts: [
        { id: "a", startMin: 14 * 60, hours: 1, location: "CENTER" },
        { id: "b", startMin: 18 * 60, hours: 1, location: "HOME" },
      ],
      fixed: [],
      anchorMin: 14 * 60,
      homeGapMin: HOME_GAP,
    });
    // a: 14:00–15:00; b: 15:30 (gap 30)
    expect(out[1]).toEqual({ id: "b", startMin: 15 * 60 + 30 });
  });

  it("skips over fixed (confirmed) sessions instead of overlapping them", () => {
    const out = compactTimes({
      drafts: [{ id: "a", startMin: 20 * 60, hours: 1, location: "CENTER" }],
      fixed: [{ startMin: 14 * 60, hours: 2 }], // 14:00–16:00 immovable
      anchorMin: 14 * 60,
      homeGapMin: 0,
    });
    expect(out).toEqual([{ id: "a", startMin: 16 * 60 }]);
  });

  it("preserves draft order by current start time", () => {
    const out = compactTimes({
      drafts: [
        { id: "late", startMin: 19 * 60, hours: 1, location: "CENTER" },
        { id: "early", startMin: 15 * 60, hours: 1, location: "CENTER" },
      ],
      fixed: [],
      anchorMin: 14 * 60,
      homeGapMin: 0,
    });
    expect(out.map((x) => x.id)).toEqual(["early", "late"]);
  });
});

describe("hhmm helpers", () => {
  it("round-trips", () => {
    expect(hhmmToMin("16:30")).toBe(990);
    expect(minToHHMM(990)).toBe("16:30");
  });
  it("falls back on garbage input", () => {
    expect(hhmmToMin("nope")).toBe(14 * 60);
    expect(hhmmToMin(null)).toBe(14 * 60);
  });
});
