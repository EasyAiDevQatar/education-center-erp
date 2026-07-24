import { describe, expect, it } from "vitest";
import {
  buildDayLegs,
  legsForPassenger,
  type PassengerDay,
} from "@/lib/transport/chain";

const HOME = { lat: 25.28, lng: 51.52 };
const CENTRE = { lat: 25.2854, lng: 51.531 };
const HOUSE_A = { lat: 25.31, lng: 51.55 };
const HOUSE_B = { lat: 25.25, lng: 51.49 };

const teacherDay = (over: Partial<PassengerDay> = {}): PassengerDay => ({
  passengerId: "t1",
  passengerKind: "TEACHER",
  name: "شيرين",
  home: HOME,
  homeLabel: "منزل المعلمة",
  points: [
    { sessionId: "s1", at: CENTRE, label: "المركز", startMin: 600, endMin: 660 },
    { sessionId: "s2", at: HOUSE_A, label: "منزل سلطان", startMin: 720, endMin: 780 },
  ],
  ...over,
});

describe("legsForPassenger", () => {
  it("builds home → first, between lessons, and last → home", () => {
    const { legs } = legsForPassenger(teacherDay());
    expect(legs.map((l) => [l.fromLabel, l.toLabel])).toEqual([
      ["منزل المعلمة", "المركز"],
      ["المركز", "منزل سلطان"],
      ["منزل سلطان", "منزل المعلمة"],
    ]);
  });

  it("derives the time window from the surrounding lessons", () => {
    const { legs } = legsForPassenger(teacherDay());
    const between = legs[1];
    expect(between.readyMin).toBe(660); // first lesson ends
    expect(between.dueMin).toBe(720); // second lesson starts
    expect(between.fromSessionId).toBe("s1");
    expect(between.toSessionId).toBe("s2");
  });

  it("pulls the deadline forward by arriveEarlyMin", () => {
    const { legs } = legsForPassenger(teacherDay(), { arriveEarlyMin: 10 });
    expect(legs[1].dueMin).toBe(710);
  });

  it("can omit the first pickup and the last dropoff", () => {
    const { legs } = legsForPassenger(teacherDay(), {
      includeFirstPickup: false,
      includeLastDropoff: false,
    });
    expect(legs).toHaveLength(1);
    expect(legs[0].fromLabel).toBe("المركز");
  });

  it("emits nothing between two lessons in the same place", () => {
    const { legs } = legsForPassenger(
      teacherDay({
        points: [
          { sessionId: "s1", at: CENTRE, label: "المركز", startMin: 600, endMin: 660 },
          { sessionId: "s2", at: CENTRE, label: "المركز", startMin: 660, endMin: 720 },
        ],
      }),
    );
    // Home → centre and centre → home only; no ride between the two lessons.
    expect(legs).toHaveLength(2);
  });

  it("sorts unordered lessons before chaining", () => {
    const { legs } = legsForPassenger(
      teacherDay({
        points: [
          { sessionId: "s2", at: HOUSE_A, label: "A", startMin: 720, endMin: 780 },
          { sessionId: "s1", at: CENTRE, label: "المركز", startMin: 600, endMin: 660 },
        ],
      }),
    );
    expect(legs[1].fromLabel).toBe("المركز");
    expect(legs[1].toLabel).toBe("A");
  });

  it("reports missing coordinates instead of guessing a leg", () => {
    const { legs, skipped } = legsForPassenger(
      teacherDay({
        points: [
          { sessionId: "s1", at: null, label: "منزل بلا إحداثيات", startMin: 600, endMin: 660 },
        ],
      }),
    );
    expect(legs).toHaveLength(0);
    expect(skipped).toHaveLength(2); // home→lesson and lesson→home
    expect(skipped[0].reason).toBe("noCoordinates");
    expect(skipped[0].detail).toBe("منزل بلا إحداثيات");
  });

  it("reports a passenger with no home coordinates", () => {
    const { skipped } = legsForPassenger(teacherDay({ home: null }));
    expect(skipped.map((s) => s.reason)).toEqual(["noCoordinates", "noCoordinates"]);
  });

  it("returns nothing for a day with no lessons", () => {
    const r = legsForPassenger(teacherDay({ points: [] }));
    expect(r.legs).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it("gives the last leg home no hard deadline", () => {
    const { legs } = legsForPassenger(teacherDay());
    expect(legs[2].dueMin).toBe(24 * 60);
  });
});

describe("buildDayLegs", () => {
  const studentDay: PassengerDay = {
    passengerId: "st1",
    passengerKind: "STUDENT",
    name: "سلطان",
    home: HOUSE_B,
    homeLabel: "منزل سلطان",
    points: [
      { sessionId: "s9", at: CENTRE, label: "المركز", startMin: 900, endMin: 960 },
    ],
  };

  it("covers teachers and students in one pass", () => {
    const { legs } = buildDayLegs([teacherDay(), studentDay]);
    const kinds = new Set(legs.map((l) => l.passengerKind));
    expect(kinds).toEqual(new Set(["TEACHER", "STUDENT"]));
  });

  it("orders legs by deadline, then id, deterministically", () => {
    const a = buildDayLegs([teacherDay(), studentDay]).legs.map((l) => l.id);
    const b = buildDayLegs([studentDay, teacherDay()]).legs.map((l) => l.id);
    expect(a).toEqual(b);
    const dues = buildDayLegs([teacherDay(), studentDay]).legs.map((l) => l.dueMin);
    expect([...dues].sort((x, y) => x - y)).toEqual(dues);
  });

  it("gives every leg a unique id", () => {
    const ids = buildDayLegs([teacherDay(), studentDay]).legs.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("first-pickup ready window", () => {
  it("does not offer the passenger for collection from midnight", () => {
    // Unbounded (readyMin 0) the allocator departs just-in-time against
    // midnight, i.e. at shift start, and delivers a teacher hours early.
    const { legs } = legsForPassenger(teacherDay());
    const first = legs[0];
    expect(first.readyMin).toBe(600 - 60); // default one-hour window
    expect(first.readyMin).toBeGreaterThan(0);
  });

  it("honours a custom advance window", () => {
    const { legs } = legsForPassenger(teacherDay(), { maxAdvancePickupMin: 20 });
    expect(legs[0].readyMin).toBe(580);
  });

  it("never goes negative for a lesson early in the day", () => {
    const { legs } = legsForPassenger(
      teacherDay({
        points: [{ sessionId: "s1", at: CENTRE, label: "المركز", startMin: 30, endMin: 90 }],
      }),
      { maxAdvancePickupMin: 60 },
    );
    expect(legs[0].readyMin).toBe(0);
  });

  it("leaves the between-lesson ready time alone", () => {
    // Mid-day legs already have a real ready time — the end of the last lesson.
    const { legs } = legsForPassenger(teacherDay());
    expect(legs[1].readyMin).toBe(660);
  });
});


describe("a real teaching day chains house to house", () => {
  // The user's exact story: three lessons at three different homes, then one
  // at the centre, then another home — starting and ending at the teacher's
  // own house. Nothing here originates at the centre unless a lesson is there.
  const HOUSE_C = { lat: 25.2, lng: 51.6 };
  const HOUSE_D = { lat: 25.33, lng: 51.45 };

  it("emits six legs in order with correct windows", () => {
    const { legs, skipped } = legsForPassenger(
      teacherDay({
        points: [
          { sessionId: "h1", at: HOUSE_A, label: "بيت 1", startMin: 540, endMin: 600 },
          { sessionId: "h2", at: HOUSE_B, label: "بيت 2", startMin: 630, endMin: 690 },
          { sessionId: "h3", at: HOUSE_C, label: "بيت 3", startMin: 720, endMin: 780 },
          { sessionId: "c1", at: CENTRE, label: "المركز", startMin: 840, endMin: 900 },
          { sessionId: "h4", at: HOUSE_D, label: "بيت 4", startMin: 960, endMin: 1020 },
        ],
      }),
    );
    expect(skipped).toHaveLength(0);
    expect(legs.map((l) => [l.fromLabel, l.toLabel])).toEqual([
      ["منزل المعلمة", "بيت 1"],
      ["بيت 1", "بيت 2"],
      ["بيت 2", "بيت 3"],
      ["بيت 3", "المركز"],
      ["المركز", "بيت 4"],
      ["بيت 4", "منزل المعلمة"],
    ]);
    // Every mid-day window is [previous lesson end, next lesson start].
    expect(legs[1].readyMin).toBe(600);
    expect(legs[1].dueMin).toBe(630);
    expect(legs[3].readyMin).toBe(780);
    expect(legs[3].dueMin).toBe(840);
    expect(legs[4].readyMin).toBe(900);
    expect(legs[4].dueMin).toBe(960);
    // The ride home has no deadline beyond the end of the day.
    expect(legs[5].readyMin).toBe(1020);
  });
});
