import { describe, expect, it } from "vitest";
import {
  DEFAULT_BILLABLE_POLICY,
  calculateBillableMinutes,
  resolveBillablePolicy,
} from "@/lib/attendance-billing";

describe("attendance billable duration", () => {
  it("preserves planned billing by default", () => {
    expect(
      calculateBillableMinutes(
        { plannedHours: 1, actualMinutes: 4 },
        DEFAULT_BILLABLE_POLICY,
      ),
    ).toBe(60);
  });

  it("can bill the exact measured minutes without a quarter-hour minimum", () => {
    expect(
      calculateBillableMinutes(
        { plannedHours: 1, actualMinutes: 4 },
        { ...DEFAULT_BILLABLE_POLICY, basis: "ACTUAL" },
      ),
    ).toBe(4);
  });

  it("supports up, down and nearest interval rounding", () => {
    const base = { ...DEFAULT_BILLABLE_POLICY, basis: "ACTUAL" as const, roundingMinutes: 15 };
    expect(calculateBillableMinutes({ plannedHours: 1, actualMinutes: 16 }, { ...base, roundingMode: "UP" })).toBe(30);
    expect(calculateBillableMinutes({ plannedHours: 1, actualMinutes: 16 }, { ...base, roundingMode: "DOWN" })).toBe(15);
    expect(calculateBillableMinutes({ plannedHours: 1, actualMinutes: 22 }, { ...base, roundingMode: "NEAREST" })).toBe(15);
    expect(calculateBillableMinutes({ plannedHours: 1, actualMinutes: 23 }, { ...base, roundingMode: "NEAREST" })).toBe(30);
  });

  it("applies a minimum and lets the planned cap remain the maximum", () => {
    expect(
      calculateBillableMinutes(
        { plannedHours: 0.5, actualMinutes: 4 },
        {
          ...DEFAULT_BILLABLE_POLICY,
          basis: "ACTUAL",
          minimumMinutes: 45,
          capAtPlanned: true,
        },
      ),
    ).toBe(30);
  });

  it("falls back to planned when a completed lesson has no checkout measurement", () => {
    expect(
      calculateBillableMinutes(
        { plannedHours: 1.5, actualMinutes: null },
        { ...DEFAULT_BILLABLE_POLICY, basis: "ACTUAL" },
      ),
    ).toBe(90);
  });

  it("validates stored settings and rejects unsupported increments", () => {
    expect(resolveBillablePolicy({ attendanceBillableRoundingMinutes: "7" }))
      .toEqual(DEFAULT_BILLABLE_POLICY);
  });
});
