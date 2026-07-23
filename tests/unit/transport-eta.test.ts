import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPEED_PROFILE,
  isRushMinute,
  parseRushWindows,
  roadKm,
  speedAt,
  travelMinutes,
  type SpeedProfile,
} from "@/lib/transport/eta";

const P = DEFAULT_SPEED_PROFILE;
const at = (h: number, m = 0) => h * 60 + m;

describe("rush windows", () => {
  it("are half-open: the start minute is rush, the end minute is not", () => {
    expect(isRushMinute(at(7, 0), P)).toBe(true);
    expect(isRushMinute(at(8, 59), P)).toBe(true);
    expect(isRushMinute(at(9, 0), P)).toBe(false);
  });

  it("covers both morning and evening peaks", () => {
    expect(isRushMinute(at(17), P)).toBe(true);
    expect(isRushMinute(at(12), P)).toBe(false);
    expect(isRushMinute(at(22), P)).toBe(false);
  });

  it("speedAt drops during rush", () => {
    expect(speedAt(at(12), P)).toBe(P.baseKmh);
    expect(speedAt(at(8), P)).toBe(P.rushKmh);
  });

  it("never divides by zero on a nonsense profile", () => {
    const broken: SpeedProfile = { ...P, baseKmh: 0, rushKmh: 0 };
    expect(speedAt(at(12), broken)).toBeGreaterThan(0);
    expect(Number.isFinite(travelMinutes(10, at(12), broken))).toBe(true);
  });
});

describe("roadKm", () => {
  it("applies the detour factor", () => {
    expect(roadKm(10, P)).toBeCloseTo(13.5);
  });

  it("is zero or negative input safe", () => {
    expect(roadKm(0, P)).toBe(0);
    expect(roadKm(-5, P)).toBe(0);
    expect(roadKm(Number.NaN, P)).toBe(0);
  });
});

describe("travelMinutes", () => {
  it("floors at minMinutes for a next-door trip", () => {
    expect(travelMinutes(0, at(12), P)).toBe(P.minMinutes);
    expect(travelMinutes(0.1, at(12), P)).toBe(P.minMinutes);
  });

  it("computes a plausible urban journey", () => {
    // 10 km straight line → 13.5 road km at 40 km/h ≈ 20.25 min → 21.
    expect(travelMinutes(10, at(12), P)).toBe(21);
  });

  it("takes longer in rush hour than off-peak", () => {
    const offPeak = travelMinutes(10, at(12), P);
    const rush = travelMinutes(10, at(8), P);
    expect(rush).toBeGreaterThan(offPeak);
  });

  it("rounds up — never promise an arrival you might miss", () => {
    // Any fractional minute becomes the next whole one.
    const m = travelMinutes(7.3, at(12), P);
    expect(Number.isInteger(m)).toBe(true);
    expect(m).toBeGreaterThanOrEqual((roadKm(7.3, P) / P.baseKmh) * 60);
  });

  it("is monotonic in distance", () => {
    let prev = 0;
    for (const km of [1, 5, 10, 25, 50]) {
      const m = travelMinutes(km, at(12), P);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });
});

describe("parseRushWindows", () => {
  it("parses the settings format", () => {
    expect(parseRushWindows("07:00-09:00,16:00-19:00")).toEqual([
      [420, 540],
      [960, 1140],
    ]);
  });

  it("tolerates whitespace", () => {
    expect(parseRushWindows(" 07:00 - 09:00 ")).toEqual([[420, 540]]);
  });

  it("skips malformed or backwards entries instead of throwing", () => {
    // A settings typo must cost the rush slowdown, not crash the allocator.
    expect(parseRushWindows("bogus,09:00-07:00,25:00-26:00,16:00-19:00")).toEqual([
      [960, 1140],
    ]);
  });

  it("returns empty for empty input", () => {
    expect(parseRushWindows("")).toEqual([]);
    expect(parseRushWindows(null)).toEqual([]);
    expect(parseRushWindows(undefined)).toEqual([]);
  });
});
