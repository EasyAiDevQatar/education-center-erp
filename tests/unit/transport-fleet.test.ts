import { describe, expect, it } from "vitest";
import {
  EXPIRY_WINDOW_DAYS,
  daysUntil,
  driverIsDispatchable,
  expiryLevel,
  latestPerType,
  shiftCovers,
  shiftIsValid,
} from "@/lib/transport/fleet";

const TODAY = new Date("2026-07-23T00:00:00.000Z");
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("daysUntil", () => {
  it("counts whole days forward and backward", () => {
    expect(daysUntil(day("2026-07-24"), TODAY)).toBe(1);
    expect(daysUntil(day("2026-08-22"), TODAY)).toBe(30);
    expect(daysUntil(day("2026-07-22"), TODAY)).toBe(-1);
  });

  it("reads a document expiring today as 0, not a fraction", () => {
    // Truncating both sides to their UTC date is the point: an expiry stamped
    // later today must not round to 1 and look like tomorrow's problem.
    expect(daysUntil(new Date("2026-07-23T23:59:00.000Z"), TODAY)).toBe(0);
  });

  it("returns null when no expiry is recorded", () => {
    expect(daysUntil(null, TODAY)).toBeNull();
    expect(daysUntil(undefined, TODAY)).toBeNull();
  });
});

describe("expiryLevel", () => {
  it("separates expired, soon and ok", () => {
    expect(expiryLevel(day("2026-07-01"), TODAY)).toBe("expired");
    expect(expiryLevel(day("2026-08-01"), TODAY)).toBe("soon");
    expect(expiryLevel(day("2027-01-01"), TODAY)).toBe("ok");
  });

  it("treats today as soon, not expired", () => {
    expect(expiryLevel(day("2026-07-23"), TODAY)).toBe("soon");
  });

  it("puts the window boundary inside soon", () => {
    const edge = new Date(TODAY);
    edge.setUTCDate(edge.getUTCDate() + EXPIRY_WINDOW_DAYS);
    expect(expiryLevel(edge, TODAY)).toBe("soon");
    edge.setUTCDate(edge.getUTCDate() + 1);
    expect(expiryLevel(edge, TODAY)).toBe("ok");
  });

  it("reports a missing expiry as unknown, never ok", () => {
    // An uninsured car must not render green just because nobody typed a date.
    expect(expiryLevel(null, TODAY)).toBe("unknown");
  });
});

describe("latestPerType", () => {
  it("keeps only the newest row per type so renewals silence the old alert", () => {
    const docs = [
      { type: "INSURANCE", expiresOn: day("2026-08-01") },
      { type: "INSURANCE", expiresOn: day("2027-08-01") },
      { type: "REGISTRATION", expiresOn: day("2026-09-01") },
    ];
    const latest = latestPerType(docs);
    expect(latest).toHaveLength(2);
    const ins = latest.find((d) => d.type === "INSURANCE")!;
    expect(ins.expiresOn).toEqual(day("2027-08-01"));
  });

  it("prefers a dated row over an undated one of the same type", () => {
    const latest = latestPerType([
      { type: "INSPECTION", expiresOn: null },
      { type: "INSPECTION", expiresOn: day("2026-12-01") },
    ]);
    expect(latest[0].expiresOn).toEqual(day("2026-12-01"));
  });

  it("keeps an undated row when it is all there is for that type", () => {
    const latest = latestPerType([{ type: "OTHER", expiresOn: null }]);
    expect(latest).toHaveLength(1);
    expect(latest[0].expiresOn).toBeNull();
  });

  it("returns nothing for no documents", () => {
    expect(latestPerType([])).toEqual([]);
  });
});

describe("shiftIsValid", () => {
  it("requires both ends, in order", () => {
    expect(shiftIsValid(6 * 60, 18 * 60)).toBe(true);
    expect(shiftIsValid(18 * 60, 6 * 60)).toBe(false);
    expect(shiftIsValid(8 * 60, 8 * 60)).toBe(false);
  });

  it("treats a half-set window as no shift rather than guessing an end", () => {
    expect(shiftIsValid(6 * 60, null)).toBe(false);
    expect(shiftIsValid(null, 18 * 60)).toBe(false);
    expect(shiftIsValid(null, null)).toBe(false);
  });

  it("rejects out-of-day bounds", () => {
    expect(shiftIsValid(-1, 600)).toBe(false);
    expect(shiftIsValid(600, 24 * 60 + 1)).toBe(false);
  });
});

describe("shiftCovers", () => {
  it("accepts a leg inside the shift and rejects one that overruns", () => {
    expect(shiftCovers(6 * 60, 18 * 60, 9 * 60, 10 * 60)).toBe(true);
    expect(shiftCovers(6 * 60, 18 * 60, 17 * 60, 19 * 60)).toBe(false);
    expect(shiftCovers(6 * 60, 18 * 60, 5 * 60, 7 * 60)).toBe(false);
  });

  it("is inclusive at both shift edges", () => {
    expect(shiftCovers(6 * 60, 18 * 60, 6 * 60, 18 * 60)).toBe(true);
  });

  it("treats a driver with no shift as always available", () => {
    expect(shiftCovers(null, null, 3 * 60, 23 * 60)).toBe(true);
  });
});

describe("driverIsDispatchable", () => {
  it("excludes inactive drivers", () => {
    expect(
      driverIsDispatchable({ active: false, licenceExpiry: day("2027-01-01") }, TODAY),
    ).toBe(false);
  });

  it("excludes an expired licence — driving on one is illegal, not a warning", () => {
    expect(
      driverIsDispatchable({ active: true, licenceExpiry: day("2026-07-01") }, TODAY),
    ).toBe(false);
  });

  it("allows a licence expiring soon, and one with no date recorded", () => {
    expect(
      driverIsDispatchable({ active: true, licenceExpiry: day("2026-08-01") }, TODAY),
    ).toBe(true);
    expect(driverIsDispatchable({ active: true, licenceExpiry: null }, TODAY)).toBe(true);
  });
});
