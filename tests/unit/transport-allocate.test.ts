import { describe, expect, it } from "vitest";
import { distanceMeters } from "@/lib/geo";
import { DEFAULT_SPEED_PROFILE } from "@/lib/transport/eta";
import {
  allocate,
  type AllocDriver,
  type AllocLeg,
  type LatLng,
} from "@/lib/transport/allocate";

const P = DEFAULT_SPEED_PROFILE;
const distanceKm = (a: LatLng, b: LatLng) =>
  distanceMeters(a.lat, a.lng, b.lat, b.lng) / 1000;
const opts = { distanceKm };

const CENTRE = { lat: 25.2854, lng: 51.531 };
const NEAR = { lat: 25.29, lng: 51.535 }; // ~0.6 km from the centre
const FAR = { lat: 25.55, lng: 51.45 }; // ~30 km north

const leg = (over: Partial<AllocLeg> = {}): AllocLeg => ({
  id: "L1",
  from: CENTRE,
  to: NEAR,
  readyMin: 600,
  dueMin: 660,
  passengers: 1,
  ...over,
});

const driver = (over: Partial<AllocDriver> = {}): AllocDriver => ({
  id: "D1",
  startAt: CENTRE,
  freeFromMin: 480,
  capacity: 4,
  ...over,
});

describe("allocate — the happy path", () => {
  it("assigns a feasible leg and reports the timings", () => {
    const { assignments, unassigned } = allocate([leg()], [driver()], P, opts);
    expect(unassigned).toEqual([]);
    expect(assignments).toHaveLength(1);
    const a = assignments[0];
    expect(a.driverId).toBe("D1");
    expect(a.pickupMin).toBeGreaterThanOrEqual(600); // never before ready
    expect(a.dropoffMin).toBeLessThanOrEqual(660); // never after due
    expect(a.slackMin).toBe(660 - a.dropoffMin);
  });

  it("never collects a passenger before they are ready", () => {
    const { assignments } = allocate([leg({ readyMin: 700, dueMin: 800 })], [driver()], P, opts);
    expect(assignments[0].pickupMin).toBeGreaterThanOrEqual(700);
  });

  it("collects late enough to arrive near the deadline, not at the first opportunity", () => {
    // `readyMin` says "not before this", not "aim for this". Collecting at the
    // earliest feasible minute is what delivered teachers an hour early.
    const { assignments } = allocate([leg({ readyMin: 600, dueMin: 800 })], [driver()], P, opts);
    const a = assignments[0];
    expect(a.pickupMin).toBeGreaterThan(600);
    expect(a.dropoffMin).toBeLessThanOrEqual(800);
    expect(a.slackMin).toBeLessThan(15); // arrives close to when it is due
  });

  it("aims for the preferred arrival when the leg names one", () => {
    const { assignments } = allocate(
      [leg({ readyMin: 600, dueMin: 800, preferredMin: 750 })],
      [driver()],
      P,
      opts,
    );
    // Targets 750, not the 800 deadline, and not the 600 earliest.
    expect(assignments[0].dropoffMin).toBeLessThanOrEqual(750);
    expect(assignments[0].dropoffMin).toBeGreaterThan(700);
  });

  it("leaves just in time instead of idling at the pickup", () => {
    // A driver free since 08:00 departs late and arrives on time — they do not
    // set off at 08:00 and wait at the kerb.
    const { assignments } = allocate([leg({ readyMin: 600, dueMin: 700 })], [driver()], P, opts);
    const a = assignments[0];
    expect(a.pickupMin).toBeGreaterThanOrEqual(600);
    expect(a.departMin).toBeGreaterThan(480);
    expect(a.idleMin).toBeGreaterThan(0); // idle before departing, not at the kerb
  });

  it("keeps the turnaround the validator will demand between two trips", () => {
    // Two legs the same driver could otherwise run back-to-back. With a 10-min
    // turnaround the second must not start the minute the first ends.
    const { assignments } = allocate(
      [
        leg({ id: "A", readyMin: 600, dueMin: 660 }),
        leg({ id: "B", from: NEAR, to: CENTRE, readyMin: 660, dueMin: 780 }),
      ],
      [driver()],
      P,
      { ...opts, turnaroundMin: 10 },
    );
    const a = assignments.find((x) => x.legId === "A")!;
    const b = assignments.find((x) => x.legId === "B")!;
    expect(b.departMin).toBeGreaterThanOrEqual(a.dropoffMin + 10);
  });

  it("moves the driver: a second leg starts from where the first ended", () => {
    const legs = [
      leg({ id: "A", from: CENTRE, to: FAR, readyMin: 600, dueMin: 720 }),
      leg({ id: "B", from: FAR, to: CENTRE, readyMin: 780, dueMin: 900 }),
    ];
    const { assignments, unassigned } = allocate(legs, [driver()], P, opts);
    expect(unassigned).toEqual([]);
    // The second leg needs no empty running — the driver is already there.
    const b = assignments.find((x) => x.legId === "B")!;
    expect(b.deadheadKm).toBeLessThan(0.1);
  });
});

describe("allocate — infeasibility is always reported, never dropped", () => {
  it("tooLate when no driver can arrive before the deadline", () => {
    // 30 km away with only 5 minutes to do it in.
    const { assignments, unassigned } = allocate(
      [leg({ from: FAR, to: CENTRE, readyMin: 600, dueMin: 605 })],
      [driver()],
      P,
      opts,
    );
    expect(assignments).toEqual([]);
    expect(unassigned).toEqual([{ legId: "L1", reason: "tooLate" }]);
  });

  it("noCapacity when the party is bigger than every vehicle", () => {
    const { unassigned } = allocate(
      [leg({ passengers: 7 })],
      [driver({ capacity: 4 })],
      P,
      opts,
    );
    expect(unassigned).toEqual([{ legId: "L1", reason: "noCapacity" }]);
  });

  it("outsideShift when the drop-off lands after the driver clocks off", () => {
    const { unassigned } = allocate(
      [leg({ readyMin: 600, dueMin: 700 })],
      [driver({ shiftEndMin: 590 })],
      P,
      opts,
    );
    expect(unassigned).toEqual([{ legId: "L1", reason: "outsideShift" }]);
  });

  it("a drop-off exactly on the shift end is still allowed", () => {
    // Pickup 600 + a 5-minute minimum ride = 605; clocking off at 605 is fine.
    const { assignments } = allocate(
      [leg({ readyMin: 600, dueMin: 700 })],
      [driver({ shiftEndMin: 605 })],
      P,
      opts,
    );
    expect(assignments).toHaveLength(1);
  });

  it("tooFar when the pickup exceeds the empty-running limit", () => {
    const { unassigned } = allocate(
      [leg({ from: FAR, to: CENTRE, readyMin: 600, dueMin: 900 })],
      [driver()],
      P,
      { ...opts, maxDeadheadKm: 5 },
    );
    expect(unassigned).toEqual([{ legId: "L1", reason: "tooFar" }]);
  });

  it("noDriver when there are no drivers at all", () => {
    const { unassigned } = allocate([leg()], [], P, opts);
    expect(unassigned).toEqual([{ legId: "L1", reason: "noDriver" }]);
  });

  it("every leg appears exactly once, assigned or not", () => {
    const legs = [
      leg({ id: "ok" }),
      leg({ id: "late", from: FAR, readyMin: 600, dueMin: 601 }),
      leg({ id: "big", passengers: 99 }),
    ];
    const { assignments, unassigned } = allocate(legs, [driver()], P, opts);
    const seen = [...assignments.map((a) => a.legId), ...unassigned.map((u) => u.legId)];
    expect(seen.sort()).toEqual(["big", "late", "ok"]);
  });
});

describe("allocate — choosing between drivers", () => {
  it("prefers the driver with less empty running", () => {
    const near = driver({ id: "near", startAt: CENTRE });
    const far = driver({ id: "far", startAt: FAR });
    const { assignments } = allocate([leg()], [far, near], P, opts);
    expect(assignments[0].driverId).toBe("near");
  });

  it("never double-books one driver across overlapping legs", () => {
    const legs = [
      leg({ id: "A", readyMin: 600, dueMin: 700 }),
      leg({ id: "B", readyMin: 600, dueMin: 700 }),
    ];
    const { assignments } = allocate(legs, [driver({ id: "solo" })], P, opts);
    // One driver can only be in one place: the second must not overlap.
    if (assignments.length === 2) {
      const [a, b] = [...assignments].sort((x, y) => x.pickupMin - y.pickupMin);
      expect(b.departMin).toBeGreaterThanOrEqual(a.dropoffMin);
    } else {
      expect(assignments).toHaveLength(1);
    }
  });

  it("spreads work when drivers are otherwise equal", () => {
    const legs = Array.from({ length: 6 }, (_, i) =>
      leg({ id: `L${i}`, readyMin: 600 + i * 60, dueMin: 660 + i * 60 }),
    );
    const drivers = [driver({ id: "A" }), driver({ id: "B" })];
    const { assignments } = allocate(legs, drivers, P, opts);
    const perDriver = new Map<string, number>();
    for (const a of assignments) {
      perDriver.set(a.driverId, (perDriver.get(a.driverId) ?? 0) + 1);
    }
    // The fairness term must stop one driver taking the whole day.
    expect(perDriver.size).toBe(2);
  });

  it("is deterministic: the same input never reshuffles the board", () => {
    const legs = [
      leg({ id: "A", readyMin: 600, dueMin: 700 }),
      leg({ id: "B", readyMin: 620, dueMin: 720 }),
      leg({ id: "C", readyMin: 640, dueMin: 740 }),
    ];
    const drivers = [driver({ id: "D1" }), driver({ id: "D2" })];
    const first = allocate(legs, drivers, P, opts);
    const again = allocate(legs, drivers, P, opts);
    expect(again).toEqual(first);
    // Driver state must not leak between runs either.
    const reversed = allocate([...legs].reverse(), drivers, P, opts);
    expect(reversed.assignments).toEqual(first.assignments);
  });

  it("processes the tightest deadline first", () => {
    const legs = [
      leg({ id: "loose", readyMin: 600, dueMin: 900 }),
      leg({ id: "tight", readyMin: 600, dueMin: 640 }),
    ];
    const { assignments } = allocate(legs, [driver()], P, opts);
    expect(assignments[0].legId).toBe("tight");
  });
});

describe("allocate — edges", () => {
  it("handles an empty leg list", () => {
    expect(allocate([], [driver()], P, opts)).toEqual({ assignments: [], unassigned: [] });
  });

  it("respects a late shift start", () => {
    const { assignments, unassigned } = allocate(
      [leg({ readyMin: 600, dueMin: 900 })],
      [driver({ shiftStartMin: 800 })],
      P,
      opts,
    );
    if (assignments.length) expect(assignments[0].departMin).toBeGreaterThanOrEqual(800);
    else expect(unassigned[0].reason).toBe("tooLate");
  });

  it("allows a late arrival only within the grace window", () => {
    const tight = [leg({ from: NEAR, to: CENTRE, readyMin: 600, dueMin: 601 })];
    expect(allocate(tight, [driver()], P, opts).unassigned).toHaveLength(1);
    expect(allocate(tight, [driver()], P, { ...opts, graceMin: 30 }).assignments).toHaveLength(1);
  });
});
