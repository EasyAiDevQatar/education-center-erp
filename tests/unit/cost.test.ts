import { describe, it, expect } from "vitest";
import {
  comparePlans,
  planCost,
  proposalIsCheaper,
  savingParts,
  DEFAULT_WEIGHTS,
  EMPTY_METRICS,
  type PlanMetrics,
} from "@/lib/transport/cost";

const plan = (over: Partial<PlanMetrics> = {}): PlanMetrics => ({ ...EMPTY_METRICS, ...over });

describe("planCost", () => {
  it("costs nothing for an empty plan", () => {
    expect(planCost(EMPTY_METRICS)).toBe(0);
  });

  it("prices every measure by its weight", () => {
    const m = plan({ tripCount: 2, emptyKm: 10 });
    expect(planCost(m)).toBe(2 * DEFAULT_WEIGHTS.tripCount + 10 * DEFAULT_WEIGHTS.emptyKm);
  });

  it("treats lateness as a penalty rather than a rejection", () => {
    // A late plan simply costs more; nothing here refuses it. The hard limits
    // live in lateness.ts so a big saving can never buy its way past a policy.
    const late = plan({ tripCount: 1, latenessMinutes: 12 });
    const onTime = plan({ tripCount: 1 });
    expect(planCost(late)).toBeGreaterThan(planCost(onTime));
    expect(Number.isFinite(planCost(late))).toBe(true);
  });

  it("honours custom weights", () => {
    const m = plan({ latenessMinutes: 10 });
    expect(planCost(m, { ...DEFAULT_WEIGHTS, latenessMinutes: 0 })).toBe(0);
  });
});

describe("comparePlans", () => {
  // The worked example from the spec: 12 minutes late buys a trip, 23 km and
  // 38 driver minutes.
  const onTime = plan({
    tripCount: 4,
    vehicleCount: 3,
    totalKm: 120,
    emptyKm: 40,
    driverMinutes: 300,
  });
  const proposed = plan({
    tripCount: 3,
    vehicleCount: 3,
    totalKm: 97,
    emptyKm: 25,
    driverMinutes: 262,
    latenessMinutes: 12,
  });

  it("reports the saving in operational units", () => {
    const c = comparePlans(onTime, proposed);
    expect(c.tripsSaved).toBe(1);
    expect(c.kmSaved).toBe(23);
    expect(c.driverMinutesSaved).toBe(38);
    expect(c.emptyKmSaved).toBe(15);
    expect(c.latenessMinutes).toBe(12);
  });

  it("keeps both trip counts for the comparison the UI must show", () => {
    const c = comparePlans(onTime, proposed);
    expect(c.onTimeTripCount).toBe(4);
    expect(c.proposedTripCount).toBe(3);
  });

  it("finds that proposal cheaper once lateness is priced in", () => {
    expect(proposalIsCheaper(comparePlans(onTime, proposed))).toBe(true);
  });

  it("reports a negative saving rather than hiding it", () => {
    // Saves a trip but drives further — the extra kilometres must still show.
    const worse = plan({ tripCount: 3, totalKm: 200, driverMinutes: 400, latenessMinutes: 20 });
    const c = comparePlans(onTime, worse);
    expect(c.tripsSaved).toBe(1);
    expect(c.kmSaved).toBeLessThan(0);
    expect(c.driverMinutesSaved).toBeLessThan(0);
  });

  it("rejects a delay that buys almost nothing", () => {
    const barely = plan({ ...onTime, totalKm: 119, latenessMinutes: 25 });
    expect(proposalIsCheaper(comparePlans(onTime, barely))).toBe(false);
  });

  it("is neutral when the two plans are identical", () => {
    const c = comparePlans(onTime, onTime);
    expect(c.costSaved).toBe(0);
    expect(proposalIsCheaper(c)).toBe(false); // no reason to delay anyone
  });
});

describe("savingParts", () => {
  it("lists only the measures that actually improved", () => {
    const c = comparePlans(
      plan({ tripCount: 4, totalKm: 120, driverMinutes: 300 }),
      plan({ tripCount: 3, totalKm: 97, driverMinutes: 262, latenessMinutes: 12 }),
    );
    expect(savingParts(c)).toEqual([
      { key: "trips", value: 1 },
      { key: "km", value: 23 },
      { key: "driverMinutes", value: 38 },
    ]);
  });

  it("says nothing when nothing improved", () => {
    expect(savingParts(comparePlans(plan({ tripCount: 2 }), plan({ tripCount: 2 })))).toEqual([]);
  });
});
