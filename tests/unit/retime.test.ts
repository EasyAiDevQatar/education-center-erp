import { describe, it, expect } from "vitest";
import { retimeStops } from "@/lib/transport/retime";

const at = (...mins: number[]) => mins.map((plannedMin) => ({ plannedMin }));

/** 15:00 lesson, 14:55 promised arrival, 15 minutes of road. */
const DELIVERY = { stops: at(14 * 60 + 40, 14 * 60 + 55), hopMin: [0, 15] };

describe("retimeStops — the shapes that have actually broken", () => {
  it("keeps a plain delivery on its promised arrival", () => {
    const r = retimeStops(DELIVERY);
    expect(r.plannedMin).toEqual([14 * 60 + 40, 14 * 60 + 55]);
    expect(r.floorApplied).toBe(false);
  });

  it("moves the pickup earlier when the road needs longer than planned", () => {
    // Promised 15 minutes of travel; the router says 22.
    const r = retimeStops({ ...DELIVERY, hopMin: [0, 22] });
    expect(r.plannedMin[1]).toBe(14 * 60 + 55); // arrival kept
    expect(r.plannedMin[0]).toBe(14 * 60 + 33); // pickup absorbs the difference
  });

  it("does not drag a mid-trip delivery past its lesson to satisfy the ride home", () => {
    // The regression. One trip: home -> student (lesson 15:00) -> home again.
    // The last stop is the ride home and has no real deadline; anchoring on it
    // pushed the delivery in the middle to 16:52 for a 15:00 lesson.
    const r = retimeStops({
      stops: at(14 * 60 + 40, 14 * 60 + 55, 17 * 60 + 7),
      hopMin: [0, 15, 15],
    });
    expect(r.plannedMin[1]).toBeLessThanOrEqual(14 * 60 + 55);
    expect(r.plannedMin[0]).toBe(14 * 60 + 40);
    expect(r.plannedMin[1]).toBe(14 * 60 + 55);
  });

  it("anchors on whichever stop is tightest, wherever it sits", () => {
    // The binding promise is the middle stop: it allows a 09:00 start, while
    // the last stop alone would allow 09:50.
    const r = retimeStops({ stops: at(600, 610, 700), hopMin: [0, 10, 30] });
    expect(r.plannedMin[0]).toBe(600);
    expect(r.plannedMin[1]).toBe(610);
    expect(r.plannedMin[2]).toBe(640); // earlier than promised is fine
  });

  it("never schedules a hop in less time than the road needs", () => {
    const r = retimeStops({ stops: at(600, 605, 610), hopMin: [0, 20, 25] });
    for (let i = 1; i < r.plannedMin.length; i++) {
      expect(r.plannedMin[i] - r.plannedMin[i - 1]).toBeGreaterThanOrEqual([0, 20, 25][i]);
    }
  });
});

describe("retimeStops — the collect floor", () => {
  it("pins the start when the passenger is not free early enough", () => {
    // Needs to leave at 14:33 to arrive on time, but is not free until 14:45.
    const r = retimeStops({ ...DELIVERY, hopMin: [0, 22], collectFloor: 14 * 60 + 45 });
    expect(r.plannedMin[0]).toBe(14 * 60 + 45);
    expect(r.floorApplied).toBe(true);
  });

  it("reports the slip rather than hiding it", () => {
    const r = retimeStops({ ...DELIVERY, hopMin: [0, 22], collectFloor: 14 * 60 + 45 });
    // 12 minutes later than the unpinned plan — the validator must see this.
    expect(r.slipMin).toBe(12);
    expect(r.plannedMin[1]).toBe(15 * 60 + 7); // arrives after the 15:00 start
  });

  it("leaves a comfortable trip alone", () => {
    const r = retimeStops({ ...DELIVERY, collectFloor: 13 * 60 });
    expect(r.floorApplied).toBe(false);
    expect(r.slipMin).toBe(0);
  });
});

describe("retimeStops — degenerate input", () => {
  it("handles an empty trip", () => {
    expect(retimeStops({ stops: [], hopMin: [] }).plannedMin).toEqual([]);
  });

  it("handles a single stop", () => {
    expect(retimeStops({ stops: at(600), hopMin: [0] }).plannedMin).toEqual([600]);
  });

  it("treats a missing hop duration as zero rather than NaN", () => {
    const r = retimeStops({ stops: at(600, 620), hopMin: [0] });
    expect(r.plannedMin.every(Number.isFinite)).toBe(true);
  });
});
