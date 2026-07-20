import { describe, it, expect } from "vitest";
import {
  effectiveMode,
  monthRange,
  monthOf,
  defaultPeriodFor,
} from "@/lib/payroll-period";

describe("effectiveMode", () => {
  it("prefers the teacher's own mode", () => {
    expect(effectiveMode("TERM", "MONTH")).toBe("TERM");
  });
  it("falls back to the centre default when the teacher inherits", () => {
    expect(effectiveMode(null, "SESSION")).toBe("SESSION");
    expect(effectiveMode(undefined, "TERM")).toBe("TERM");
  });
  it("defaults to MONTH when neither is set or values are junk", () => {
    expect(effectiveMode(null, null)).toBe("MONTH");
    expect(effectiveMode("WEEKLY", "NOPE")).toBe("MONTH");
  });
});

describe("monthRange", () => {
  it("covers a 31-day month", () => {
    expect(monthRange("2026-07")).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });
  it("covers a 30-day month", () => {
    expect(monthRange("2026-09")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("handles February in a leap year", () => {
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
  it("handles February in a non-leap year", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("monthOf", () => {
  it("extracts the month", () => {
    expect(monthOf("2026-07-20")).toBe("2026-07");
  });
});

describe("defaultPeriodFor", () => {
  const fallback = { from: "2020-01-01", to: "2020-12-31" };
  const term = { startDate: "2026-09-01", endDate: "2026-12-31" };

  it("MONTH uses the calendar month of today", () => {
    expect(defaultPeriodFor("MONTH", { today: "2026-07-20", fallback })).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("TERM uses the current term's dates", () => {
    expect(
      defaultPeriodFor("TERM", { today: "2026-10-05", currentTerm: term, fallback }),
    ).toEqual({ from: "2026-09-01", to: "2026-12-31" });
  });

  it("TERM falls back when no term is active", () => {
    expect(
      defaultPeriodFor("TERM", { today: "2026-07-20", currentTerm: null, fallback }),
    ).toEqual(fallback);
  });

  it("SESSION keeps the existing free-form range", () => {
    expect(defaultPeriodFor("SESSION", { today: "2026-07-20", fallback })).toEqual(fallback);
  });
});
