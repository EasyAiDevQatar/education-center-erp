import { describe, it, expect } from "vitest";
import { weeklyOccurrences } from "@/lib/recurrence";

// 2026-08-01 is a Saturday (UTC day 6).
describe("weeklyOccurrences", () => {
  it("defaults to the start date's weekday when none selected", () => {
    // 4 Saturdays starting 2026-08-01
    expect(weeklyOccurrences("2026-08-01", [], 4)).toEqual([
      "2026-08-01",
      "2026-08-08",
      "2026-08-15",
      "2026-08-22",
    ]);
  });

  it("emits one date per selected weekday per week", () => {
    // Sundays (0) and Tuesdays (2) for 2 weeks, starting Sat 2026-08-01.
    // First Sunday on/after = 08-02, first Tuesday = 08-04.
    expect(weeklyOccurrences("2026-08-01", [0, 2], 2)).toEqual([
      "2026-08-02",
      "2026-08-04",
      "2026-08-09",
      "2026-08-11",
    ]);
  });

  it("never emits a date before the start", () => {
    // Start Wed 2026-08-05; selecting Saturday (6) → first is 08-08, not 08-01.
    const out = weeklyOccurrences("2026-08-05", [6], 3);
    expect(out[0]).toBe("2026-08-08");
    expect(out).toHaveLength(3);
    expect(out.every((d) => d >= "2026-08-05")).toBe(true);
  });

  it("clamps weeks to at least 1 and dedupes", () => {
    expect(weeklyOccurrences("2026-08-01", [6, 6], 0)).toEqual(["2026-08-01"]);
  });

  it("returns [] for an invalid date", () => {
    expect(weeklyOccurrences("not-a-date", [1], 3)).toEqual([]);
  });
});
