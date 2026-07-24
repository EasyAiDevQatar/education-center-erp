import { describe, it, expect } from "vitest";
import {
  arrivalWindow,
  departureFloor,
  validateArrival,
  validateDeparture,
  validateTrip,
  turnaroundFeasible,
  coordValid,
  type TransportRules,
  type StopForValidation,
} from "@/lib/transport/validate";

const H = (h: number, m = 0) => h * 60 + m;

const R: TransportRules = {
  preferredArrivalBufferMin: 15,
  minArrivalBufferMin: 5,
  maxEarlyArrivalMin: 30,
  dismissalBufferMin: 10,
  maxStudentWaitMin: 20,
  maxJourneyMin: 60,
  hardMaxJourneyMin: 120,
  minDriverTurnaroundMin: 10,
  minVehicleTurnaroundMin: 10,
  preTripInspectionMin: 5,
  postTripCloseoutMin: 5,
};

describe("time windows (spec §6)", () => {
  it("computes the arrival window from the session start", () => {
    const w = arrivalWindow(H(15), R); // 15:00
    expect(w.preferred).toBe(H(14, 45));
    expect(w.latest).toBe(H(14, 55));
    expect(w.earliest).toBe(H(14, 30));
  });
  it("computes the earliest departure from the session end", () => {
    expect(departureFloor(H(17, 30), R)).toBe(H(17, 40));
  });
});

describe("arrival validation (spec §34 cases 1-4)", () => {
  it("15 min before → VALID", () => {
    expect(validateArrival(H(14, 45), H(15), R)).toEqual([]);
  });
  it("2 min earlier than preferred (14:43) → VALID (spec §27 example)", () => {
    expect(validateArrival(H(14, 43), H(15), R)).toEqual([]);
  });
  it("after the latest allowed (14:58) → INVALID", () => {
    const m = validateArrival(H(14, 58), H(15), R);
    expect(m[0].level).toBe("INVALID");
    expect(m[0].code).toBe("ARRIVAL_AFTER_LATEST");
  });
  it("after the session starts (15:05) → INVALID", () => {
    const m = validateArrival(H(15, 5), H(15), R);
    expect(m[0].level).toBe("INVALID");
    expect(m[0].code).toBe("ARRIVAL_AFTER_SESSION_START");
  });
  it("90 min early (13:30) → WARNING", () => {
    const m = validateArrival(H(13, 30), H(15), R);
    expect(m[0].level).toBe("WARNING");
    expect(m[0].code).toBe("EXCESSIVE_EARLY_ARRIVAL");
  });
});

describe("departure validation (spec §34 cases 5-6)", () => {
  it("leaves before the session ends → INVALID", () => {
    const m = validateDeparture(H(17, 20), H(17, 30), R);
    expect(m[0].level).toBe("INVALID");
    expect(m[0].code).toBe("DEPART_BEFORE_READY");
  });
  it("leaves after end but before the dismissal buffer → INVALID", () => {
    const m = validateDeparture(H(17, 35), H(17, 30), R); // ready 17:40
    expect(m[0].level).toBe("INVALID");
  });
  it("leaves at ready time → VALID", () => {
    expect(validateDeparture(H(17, 40), H(17, 30), R)).toEqual([]);
  });
  it("waits far past ready → WARNING", () => {
    const m = validateDeparture(H(18, 10), H(17, 30), R); // ready 17:40, waits 30 > 20
    expect(m[0].level).toBe("WARNING");
    expect(m[0].code).toBe("EXCESSIVE_WAIT");
  });
});

describe("turnaround feasibility (spec §34 cases 13-14, §20)", () => {
  it("insufficient gap between consecutive trips → infeasible", () => {
    // prev ends 15:00, deadhead 20, need 5+20+10+5 = 40 → next must be ≥ 15:40
    expect(turnaroundFeasible(H(15), H(15, 30), 20, R.minDriverTurnaroundMin, R)).toBe(false);
  });
  it("sufficient gap → feasible", () => {
    expect(turnaroundFeasible(H(15), H(15, 45), 20, R.minDriverTurnaroundMin, R)).toBe(true);
  });
});

describe("validateTrip (whole route)", () => {
  const stop = (o: Partial<StopForValidation> & { seq: number; kind: string; plannedMin: number }): StopForValidation => o;

  it("clean pickup route → VALID", () => {
    const stops = [
      stop({ seq: 1, kind: "PICKUP", plannedMin: H(14, 20) }),
      stop({ seq: 2, kind: "DROPOFF", plannedMin: H(14, 45), sessionStartMin: H(15), servesSession: true }),
    ];
    expect(validateTrip(stops, R).status).toBe("VALID");
  });

  it("late drop-off makes the whole trip INVALID (spec §2)", () => {
    const stops = [
      stop({ seq: 1, kind: "PICKUP", plannedMin: H(14, 40) }),
      stop({ seq: 2, kind: "DROPOFF", plannedMin: H(15, 5), sessionStartMin: H(15), servesSession: true }),
    ];
    expect(validateTrip(stops, R).status).toBe("INVALID");
  });

  it("fallback-estimated leg downgrades to at least WARNING (spec §14)", () => {
    const stops = [
      stop({ seq: 1, kind: "PICKUP", plannedMin: H(14, 20), fallbackUsed: true }),
      stop({ seq: 2, kind: "DROPOFF", plannedMin: H(14, 45), sessionStartMin: H(15), servesSession: true }),
    ];
    const v = validateTrip(stops, R);
    expect(v.status).toBe("WARNING");
    expect(v.messages.some((m) => m.code === "TRAVEL_TIME_FALLBACK_USED")).toBe(true);
  });

  it("journey over the hard maximum → INVALID", () => {
    const stops = [
      stop({ seq: 1, kind: "PICKUP", plannedMin: H(13) }),
      stop({ seq: 2, kind: "DROPOFF", plannedMin: H(15, 10), sessionStartMin: H(15, 30), servesSession: true }),
    ];
    expect(validateTrip(stops, R).status).toBe("INVALID"); // 130 > 120
  });
});

describe("road-time feasibility (spec §17-18, §34 cases 23-26)", () => {
  const stop = (o: Partial<StopForValidation> & { seq: number; kind: string; plannedMin: number }): StopForValidation => o;

  it("real road time that no longer fits the planned gap → INVALID", () => {
    // 20 min scheduled between the stops, but OSRM says the leg is 26 min.
    const stops = [
      stop({ seq: 1, kind: "PICKUP", plannedMin: H(14, 20), fallbackUsed: false }),
      stop({ seq: 2, kind: "DROPOFF", plannedMin: H(14, 40), sessionStartMin: H(15), servesSession: true, fallbackUsed: false, roadTravelFromPrevS: 26 * 60 }),
    ];
    const v = validateTrip(stops, R);
    expect(v.status).toBe("INVALID");
    expect(v.messages.some((m) => m.code === "INSUFFICIENT_TRAVEL_TIME")).toBe(true);
  });

  it("real road time that fits the gap → VALID", () => {
    const stops = [
      stop({ seq: 1, kind: "PICKUP", plannedMin: H(14, 20), fallbackUsed: false }),
      stop({ seq: 2, kind: "DROPOFF", plannedMin: H(14, 45), sessionStartMin: H(15), servesSession: true, fallbackUsed: false, roadTravelFromPrevS: 18 * 60 }),
    ];
    expect(validateTrip(stops, R).status).toBe("VALID");
  });

  it("does NOT hard-fail on the estimator (fallback stays WARNING, not INVALID)", () => {
    const stops = [
      stop({ seq: 1, kind: "PICKUP", plannedMin: H(14, 20), fallbackUsed: true }),
      stop({ seq: 2, kind: "DROPOFF", plannedMin: H(14, 40), sessionStartMin: H(15), servesSession: true, fallbackUsed: true, roadTravelFromPrevS: 26 * 60 }),
    ];
    const v = validateTrip(stops, R);
    expect(v.status).toBe("WARNING");
    expect(v.messages.some((m) => m.code === "INSUFFICIENT_TRAVEL_TIME")).toBe(false);
  });
});

describe("coordinate validation (spec §31)", () => {
  it("rejects null / out-of-range / null-island, accepts real Doha pins", () => {
    expect(coordValid(25.2854, 51.531)).toBe(true);
    expect(coordValid(null, 51.531)).toBe(false);
    expect(coordValid(25.2854, null)).toBe(false);
    expect(coordValid(0, 0)).toBe(false);
    expect(coordValid(91, 51)).toBe(false);
    expect(coordValid(25, 181)).toBe(false);
    expect(coordValid(Number.NaN, 51)).toBe(false);
  });
});
