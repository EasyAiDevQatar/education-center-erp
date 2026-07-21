import { describe, it, expect } from "vitest";
import {
  inRange,
  anyDateInRanges,
  rangesOverlap,
  type YearRange,
} from "@/lib/academic-year-rules";

const y2025: YearRange = {
  start: new Date("2025-09-01T00:00:00.000Z"),
  end: new Date("2026-06-30T23:59:59.999Z"),
};
const y2026: YearRange = {
  start: new Date("2026-09-01T00:00:00.000Z"),
  end: new Date("2027-06-30T23:59:59.999Z"),
};

const d = (s: string) => new Date(`${s}T12:00:00.000Z`);

describe("inRange", () => {
  it("includes both ends", () => {
    expect(inRange(y2025.start, y2025)).toBe(true);
    expect(inRange(y2025.end, y2025)).toBe(true);
  });

  it("excludes a date just outside", () => {
    expect(inRange(new Date("2025-08-31T23:59:59.999Z"), y2025)).toBe(false);
    expect(inRange(new Date("2026-07-01T00:00:00.000Z"), y2025)).toBe(false);
  });
});

describe("anyDateInRanges", () => {
  it("is false when nothing is archived", () => {
    expect(anyDateInRanges([], [d("2025-10-01")])).toBe(false);
  });

  it("catches a date inside an archived year", () => {
    expect(anyDateInRanges([y2025], [d("2025-10-01")])).toBe(true);
  });

  it("passes a date in the summer gap between years", () => {
    expect(anyDateInRanges([y2025, y2026], [d("2026-07-15")])).toBe(false);
  });

  it("blocks when EITHER date is frozen — moving out of a closed year", () => {
    // old date archived, new date open
    expect(anyDateInRanges([y2025], [d("2026-07-15"), d("2025-10-01")])).toBe(true);
  });

  it("blocks when the NEW date is frozen — smuggling a record in", () => {
    expect(anyDateInRanges([y2025], [d("2025-10-01"), d("2026-07-15")])).toBe(true);
  });

  it("ignores null, undefined and unparseable dates", () => {
    expect(anyDateInRanges([y2025], [null, undefined])).toBe(false);
    expect(anyDateInRanges([y2025], ["not-a-date"])).toBe(false);
  });

  it("accepts ISO strings as well as Date objects", () => {
    expect(anyDateInRanges([y2025], ["2025-10-01T09:00:00.000Z"])).toBe(true);
  });

  it("checks every archived year, not just the first", () => {
    expect(anyDateInRanges([y2025, y2026], [d("2026-10-01")])).toBe(true);
  });
});

describe("rangesOverlap", () => {
  it("is false for consecutive years with a gap", () => {
    expect(rangesOverlap(y2025, y2026)).toBe(false);
  });

  it("is true when one starts before the other ends", () => {
    const overlapping: YearRange = {
      start: new Date("2026-06-01T00:00:00.000Z"),
      end: new Date("2027-05-31T23:59:59.999Z"),
    };
    expect(rangesOverlap(y2025, overlapping)).toBe(true);
  });

  it("is true for a single shared day", () => {
    const touching: YearRange = {
      start: y2025.end,
      end: new Date("2027-01-01T00:00:00.000Z"),
    };
    expect(rangesOverlap(y2025, touching)).toBe(true);
  });
});
