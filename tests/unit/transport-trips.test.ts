import { describe, expect, it } from "vitest";
import {
  canTransition,
  generatorMayReplace,
  isOpen,
  legKeyFor,
  nextStatuses,
} from "@/lib/transport/trips";
import { TRIP_STATUSES, type TripStatus } from "@/lib/enums";

describe("legKeyFor", () => {
  const leg = {
    passengerKind: "TEACHER",
    passengerId: "t1",
    fromSessionId: "s1",
    toSessionId: "s2",
  };

  it("is stable for the same ride", () => {
    expect(legKeyFor(leg)).toBe(legKeyFor({ ...leg }));
  });

  it("names the open ends of the day rather than leaving them blank", () => {
    expect(legKeyFor({ ...leg, fromSessionId: null })).toBe("TEACHER:t1:home:s2");
    expect(legKeyFor({ ...leg, toSessionId: null })).toBe("TEACHER:t1:s1:home");
  });

  it("does not depend on the leg's position in the day", () => {
    // The whole point: inserting an earlier lesson renumbers every leg, and an
    // index-based key would duplicate the entire board on the next run.
    const morning = legKeyFor({ ...leg, fromSessionId: "s1", toSessionId: "s2" });
    const sameRideLaterInADifferentDay = legKeyFor({
      passengerKind: "TEACHER",
      passengerId: "t1",
      fromSessionId: "s1",
      toSessionId: "s2",
    });
    expect(sameRideLaterInADifferentDay).toBe(morning);
  });

  it("separates passengers, kinds and directions", () => {
    expect(legKeyFor({ ...leg, passengerId: "t2" })).not.toBe(legKeyFor(leg));
    expect(legKeyFor({ ...leg, passengerKind: "STUDENT" })).not.toBe(legKeyFor(leg));
    // The return trip is a different ride from the outbound one.
    expect(legKeyFor({ ...leg, fromSessionId: "s2", toSessionId: "s1" })).not.toBe(
      legKeyFor(leg),
    );
  });
});

describe("canTransition", () => {
  it("lets a proposal be approved or rejected", () => {
    expect(canTransition("PROPOSED", "ASSIGNED")).toBe(true);
    expect(canTransition("PROPOSED", "CANCELLED")).toBe(true);
  });

  it("refuses to skip the assignment step", () => {
    expect(canTransition("PROPOSED", "STARTED")).toBe(false);
    expect(canTransition("PROPOSED", "COMPLETED")).toBe(false);
  });

  it("walks the running trip forward one step at a time", () => {
    expect(canTransition("ASSIGNED", "STARTED")).toBe(true);
    expect(canTransition("STARTED", "COMPLETED")).toBe(true);
    expect(canTransition("ASSIGNED", "COMPLETED")).toBe(false);
  });

  it("treats COMPLETED and CANCELLED as terminal", () => {
    for (const s of TRIP_STATUSES) {
      expect(canTransition("COMPLETED", s)).toBe(false);
      expect(canTransition("CANCELLED", s)).toBe(false);
    }
  });

  it("never allows a trip to move to its own status", () => {
    for (const s of TRIP_STATUSES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });

  it("allows cancelling from every non-terminal status", () => {
    for (const s of ["PLANNED", "PROPOSED", "ASSIGNED", "STARTED"] as TripStatus[]) {
      expect(canTransition(s, "CANCELLED")).toBe(true);
    }
  });
});

describe("nextStatuses", () => {
  it("returns a copy, so a caller cannot mutate the rules", () => {
    const a = nextStatuses("PROPOSED");
    a.push("COMPLETED");
    expect(nextStatuses("PROPOSED")).not.toContain("COMPLETED");
  });

  it("is empty for terminal statuses", () => {
    expect(nextStatuses("COMPLETED")).toEqual([]);
    expect(nextStatuses("CANCELLED")).toEqual([]);
  });
});

describe("isOpen", () => {
  it("counts everything except the terminal states", () => {
    expect(isOpen("PROPOSED")).toBe(true);
    expect(isOpen("ASSIGNED")).toBe(true);
    expect(isOpen("STARTED")).toBe(true);
    expect(isOpen("COMPLETED")).toBe(false);
    expect(isOpen("CANCELLED")).toBe(false);
  });
});

describe("generatorMayReplace", () => {
  it("only ever touches its own untouched proposals", () => {
    expect(generatorMayReplace("PROPOSED")).toBe(true);
  });

  it("leaves anything a human has acted on alone", () => {
    // Re-running generation must not undo a dispatcher's approval or a driver
    // who is already on the road.
    for (const s of ["PLANNED", "ASSIGNED", "STARTED", "COMPLETED", "CANCELLED"] as TripStatus[]) {
      expect(generatorMayReplace(s)).toBe(false);
    }
  });
});
