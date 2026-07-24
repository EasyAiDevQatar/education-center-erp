import { describe, expect, it } from "vitest";
import {
  costPerKm,
  costPerTrip,
  driverUtilisation,
  fuelEconomy,
  onTimeRate,
  type FuelEntry,
  type TripSpan,
} from "@/lib/transport/costs";

const fill = (over: Partial<FuelEntry> = {}): FuelEntry => ({
  date: "2026-07-01",
  litres: 50,
  cost: 100,
  odometerKm: 10_000,
  ...over,
});

describe("fuelEconomy", () => {
  it("uses full-to-full: the first fill's litres are excluded", () => {
    // 10,000 → 10,600 km on the 40 L bought at the SECOND fill.
    // Counting the first 50 L too would report 600/90 = 6.7 and understate it.
    const r = fuelEconomy([
      fill({ odometerKm: 10_000, litres: 50 }),
      fill({ odometerKm: 10_600, litres: 40, date: "2026-07-08" }),
    ]);
    expect(r.km).toBe(600);
    expect(r.litres).toBe(40);
    expect(r.kmPerLitre).toBe(15);
  });

  it("needs two readings before it will claim anything", () => {
    expect(fuelEconomy([]).kmPerLitre).toBeNull();
    expect(fuelEconomy([fill()]).kmPerLitre).toBeNull();
  });

  it("ignores fills with no odometer rather than guessing", () => {
    const r = fuelEconomy([
      fill({ odometerKm: 10_000, litres: 50 }),
      fill({ odometerKm: null, litres: 30 }),
      fill({ odometerKm: 10_400, litres: 40 }),
    ]);
    expect(r.km).toBe(400);
    expect(r.litres).toBe(40); // the null-odometer fill contributes nothing
    expect(r.kmPerLitre).toBe(10);
  });

  it("returns null instead of a nonsense figure when the odometer did not move", () => {
    const r = fuelEconomy([
      fill({ odometerKm: 10_000, litres: 50 }),
      fill({ odometerKm: 10_000, litres: 40 }),
    ]);
    expect(r.kmPerLitre).toBeNull();
  });

  it("sorts by odometer, so entries arriving out of order still work", () => {
    const r = fuelEconomy([
      fill({ odometerKm: 10_600, litres: 40, date: "2026-07-08" }),
      fill({ odometerKm: 10_000, litres: 50, date: "2026-07-01" }),
    ]);
    expect(r.kmPerLitre).toBe(15);
  });
});

describe("costPerKm / costPerTrip", () => {
  it("computes the obvious cases", () => {
    expect(costPerKm(250, 1000)).toBe(0.25);
    expect(costPerTrip(300, 12)).toBe(25);
  });

  it("returns null rather than dividing by zero", () => {
    // Infinity or NaN rendered in a report is worse than an honest dash.
    expect(costPerKm(250, 0)).toBeNull();
    expect(costPerKm(250, -5)).toBeNull();
    expect(costPerTrip(300, 0)).toBeNull();
  });
});

describe("driverUtilisation", () => {
  const trips: TripSpan[] = [
    { driverId: "d1", plannedStartMin: 600, plannedEndMin: 660, estimatedKm: 12, status: "COMPLETED" },
    { driverId: "d1", plannedStartMin: 700, plannedEndMin: 730, estimatedKm: 8, status: "ASSIGNED" },
    { driverId: "d2", plannedStartMin: 600, plannedEndMin: 615, estimatedKm: 4, status: "COMPLETED" },
  ];
  const shifts = {
    d1: { startMin: 360, endMin: 1080 }, // 12 h = 720 min
    d2: { startMin: 360, endMin: 1080 },
  };

  it("totals trips, busy minutes and km per driver", () => {
    const r = driverUtilisation(trips, shifts);
    const d1 = r.find((x) => x.driverId === "d1")!;
    expect(d1.trips).toBe(2);
    expect(d1.busyMin).toBe(90);
    expect(d1.km).toBe(20);
    expect(d1.utilisation).toBeCloseTo(90 / 720, 4);
  });

  it("excludes cancelled trips — planning is not work done", () => {
    const withCancelled = [
      ...trips,
      { driverId: "d2", plannedStartMin: 800, plannedEndMin: 900, estimatedKm: 30, status: "CANCELLED" },
    ];
    const d2 = driverUtilisation(withCancelled, shifts).find((x) => x.driverId === "d2")!;
    expect(d2.trips).toBe(1);
    expect(d2.busyMin).toBe(15);
    expect(d2.km).toBe(4);
  });

  it("reports null utilisation for a driver with no usable shift", () => {
    const r = driverUtilisation(trips, { d1: { startMin: null, endMin: null }, d2: shifts.d2 });
    expect(r.find((x) => x.driverId === "d1")!.utilisation).toBeNull();
  });

  it("caps utilisation at 1 — overrunning a shift is not 130% productivity", () => {
    const long: TripSpan[] = [
      { driverId: "d1", plannedStartMin: 0, plannedEndMin: 1400, estimatedKm: 5, status: "COMPLETED" },
    ];
    expect(driverUtilisation(long, shifts)[0].utilisation).toBe(1);
  });

  it("ignores trips with no driver, and is deterministic", () => {
    const r = driverUtilisation(
      [...trips, { driverId: null, plannedStartMin: 0, plannedEndMin: 60, estimatedKm: 9, status: "ASSIGNED" }],
      shifts,
    );
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.driverId)).toEqual(["d1", "d2"]); // busiest first
  });

  it("returns nothing for no trips", () => {
    expect(driverUtilisation([], shifts)).toEqual([]);
  });
});

describe("onTimeRate", () => {
  it("counts arrivals within the grace window as on time", () => {
    const r = onTimeRate([
      { plannedMin: 600, actualMin: 598 },
      { plannedMin: 600, actualMin: 605 }, // exactly on the 5-min grace
      { plannedMin: 600, actualMin: 620 },
    ]);
    expect(r.measured).toBe(3);
    expect(r.onTime).toBe(2);
    expect(r.rate).toBeCloseTo(2 / 3, 4);
  });

  it("excludes unstamped stops from both sides, not counting them late", () => {
    // Otherwise the metric measures whether drivers tap the button, not
    // whether they arrive on time.
    const r = onTimeRate([
      { plannedMin: 600, actualMin: 595 },
      { plannedMin: 700, actualMin: null },
      { plannedMin: 800, actualMin: null },
    ]);
    expect(r.measured).toBe(1);
    expect(r.rate).toBe(1);
  });

  it("returns null when nothing was measured", () => {
    expect(onTimeRate([]).rate).toBeNull();
    expect(onTimeRate([{ plannedMin: 600, actualMin: null }]).rate).toBeNull();
  });

  it("honours a custom grace", () => {
    expect(onTimeRate([{ plannedMin: 600, actualMin: 603 }], 0).onTime).toBe(0);
    expect(onTimeRate([{ plannedMin: 600, actualMin: 603 }], 10).onTime).toBe(1);
  });
});
