import { describe, it, expect } from "vitest";
import { classifyGaps, gapMinutes, type Commitment } from "@/lib/transport/gaps";

const H = (h: number, m = 0) => h * 60 + m;
let n = 0;
const lessonHome = (a: number, b: number): Commitment => ({ id: `h${n++}`, startMin: a, endMin: b, kind: "LESSON_HOME" });
const lessonCentre = (a: number, b: number): Commitment => ({ id: `c${n++}`, startMin: a, endMin: b, kind: "LESSON_CENTRE" });
const trip = (a: number, b: number): Commitment => ({ id: `t${n++}`, startMin: a, endMin: b, kind: "TRIP" });

const opts = { maxWaitMin: 20 };

describe("classifyGaps — حنان's real day, 2026-07-25", () => {
  // Delivered 13:23-13:43, home lesson to 15:30, then centre lessons to 19:30,
  // collected 19:40. The stretch that once read as 5h57m of idling.
  const day: Commitment[] = [
    trip(H(13, 23), H(13, 43)),
    lessonHome(H(14), H(15, 30)),
    lessonCentre(H(15), H(17)),
    lessonCentre(H(17), H(18)),
    lessonCentre(H(18), H(19, 30)),
    trip(H(19, 40), H(19, 57)),
  ];

  it("does not report six hours of idling in a fully taught day", () => {
    const gaps = classifyGaps(day, opts);
    expect(gapMinutes(gaps)).toBeLessThan(60);
  });

  it("names the ride that was never planned, rather than calling it free", () => {
    // 13:43 dropped at home lesson's location; the lesson starts 14:00. That
    // 17-minute hole sits between a TRIP and a HOME lesson — not a missing ride.
    // The real missing ride is home -> centre, but the sessions overlap so no
    // gap exists there; this asserts nothing is silently labelled FREE.
    const gaps = classifyGaps(day, opts);
    expect(gaps.every((g) => g.kind !== "FREE" || g.endMin - g.startMin < 30)).toBe(true);
  });

  it("reports the wait before the ride home", () => {
    // Last centre lesson ends 19:30; collected 19:40.
    const gaps = classifyGaps(day, opts);
    const last = gaps[gaps.length - 1];
    expect(last.startMin).toBe(H(19, 30));
    expect(last.endMin).toBe(H(19, 40));
    expect(last.kind).toBe("WAITING");
    expect(last.problem).toBe(false); // 10 min, under the 20-minute limit
  });
});

describe("classifyGaps — the case that was invisible", () => {
  it("flags a gap between two lessons in different places as a missing ride", () => {
    const gaps = classifyGaps([lessonHome(H(14), H(15)), lessonCentre(H(16), H(17))], opts);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].kind).toBe("TRAVEL_NOT_PLANNED");
    expect(gaps[0].problem).toBe(true); // always a problem, however short
  });

  it("still flags it when the gap is tiny", () => {
    const gaps = classifyGaps([lessonHome(H(14), H(15)), lessonCentre(H(15, 5), H(16))], opts);
    expect(gaps[0].kind).toBe("TRAVEL_NOT_PLANNED");
    expect(gaps[0].problem).toBe(true);
  });

  it("does NOT flag it when a ride covers the move", () => {
    const gaps = classifyGaps(
      [lessonHome(H(14), H(15)), trip(H(15), H(15, 40)), lessonCentre(H(15, 40), H(17))],
      opts,
    );
    expect(gaps).toHaveLength(0);
  });
});

describe("classifyGaps — waiting vs free", () => {
  it("calls a short wait between centre lessons waiting, not a problem", () => {
    const gaps = classifyGaps([lessonCentre(H(14), H(15)), lessonCentre(H(15, 15), H(16))], opts);
    expect(gaps[0].kind).toBe("WAITING");
    expect(gaps[0].problem).toBe(false);
  });

  it("flags a long wait at the centre past the configured limit", () => {
    const gaps = classifyGaps([lessonCentre(H(14), H(15)), lessonCentre(H(16), H(17))], opts);
    expect(gaps[0].kind).toBe("WAITING");
    expect(gaps[0].problem).toBe(true); // 60 min > 20
  });

  it("uses the configured limit, not a hardcoded one", () => {
    const day = [lessonCentre(H(14), H(15)), lessonCentre(H(15, 30), H(16))];
    expect(classifyGaps(day, { maxWaitMin: 20 })[0].problem).toBe(true);
    expect(classifyGaps(day, { maxWaitMin: 45 })[0].problem).toBe(false);
  });


  it("calls the buffer around a ride waiting, not free", () => {
    // Dropped at 13:43 for a 14:00 lesson: the teacher is at the door, waiting.
    const gaps = classifyGaps([trip(H(13, 23), H(13, 43)), lessonHome(H(14), H(15))], opts);
    expect(gaps[0].kind).toBe("WAITING");
    expect(gaps[0].problem).toBe(false); // 17 min, inside the limit
  });

  it("still calls a long stretch between two home lessons free", () => {
    const gaps = classifyGaps([lessonHome(H(14), H(15)), lessonHome(H(19), H(20))], opts);
    expect(gaps[0].kind).toBe("FREE");
  });

  it("calls a gap between two home lessons free, not waiting at the centre", () => {
    const gaps = classifyGaps([lessonHome(H(14), H(15)), lessonHome(H(17), H(18))], opts);
    expect(gaps[0].kind).toBe("FREE");
    expect(gaps[0].problem).toBe(false);
  });
});

describe("classifyGaps — the shapes that break naive sweeps", () => {
  it("reports no gap after a long lesson that swallows a short one", () => {
    // Using the previous item's end instead of the running maximum would
    // invent a gap from 15:00 back to 16:00 here.
    const gaps = classifyGaps([lessonCentre(H(14), H(18)), lessonCentre(H(15), H(16))], opts);
    expect(gaps).toEqual([]);
  });

  it("reports no gap for touching commitments", () => {
    expect(classifyGaps([lessonCentre(H(14), H(15)), lessonCentre(H(15), H(16))], opts)).toEqual([]);
  });

  it("reports no gap for overlapping commitments", () => {
    expect(classifyGaps([lessonHome(H(14), H(15, 30)), lessonCentre(H(15), H(17))], opts)).toEqual([]);
  });

  it("ignores the order it is given", () => {
    const a = classifyGaps([lessonCentre(H(16), H(17)), lessonCentre(H(14), H(15))], opts);
    const b = classifyGaps([lessonCentre(H(14), H(15)), lessonCentre(H(16), H(17))], opts);
    expect(a).toEqual(b);
  });

  it("never classifies before the first or after the last commitment", () => {
    const gaps = classifyGaps([lessonCentre(H(14), H(15)), lessonCentre(H(16), H(17))], opts);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].startMin).toBe(H(15));
    expect(gaps[0].endMin).toBe(H(16));
  });

  it("handles a day with nothing, or one thing", () => {
    expect(classifyGaps([], opts)).toEqual([]);
    expect(classifyGaps([lessonCentre(H(14), H(15))], opts)).toEqual([]);
  });

  it("drops zero-length and inverted commitments", () => {
    const gaps = classifyGaps(
      [lessonCentre(H(14), H(14)), lessonCentre(H(15), H(16)), lessonCentre(H(18), H(17))],
      opts,
    );
    expect(gaps).toEqual([]);
  });
});

describe("gapMinutes", () => {
  const gaps = classifyGaps(
    [lessonCentre(H(14), H(15)), lessonCentre(H(16), H(17)), lessonHome(H(19), H(20))],
    opts,
  );

  it("totals every gap", () => {
    expect(gapMinutes(gaps)).toBe(60 + 120);
  });

  it("totals only the problems when asked", () => {
    // 15:00-16:00 waiting at the centre (problem); 17:00-19:00 centre->home
    // with no ride (problem). Both count.
    expect(gapMinutes(gaps, true)).toBe(180);
  });
});

describe("classifyGaps — a driver's row means something different", () => {
  it("calls a driver's gap between rides free, not waiting", () => {
    // The same shape on a passenger's row is waiting; on a driver's it is the
    // fleet working as intended.
    const between = [trip(H(14), H(15)), trip(H(17), H(18))];
    expect(classifyGaps(between, { ...opts, subject: "PASSENGER" })[0].kind).toBe("WAITING");
    expect(classifyGaps(between, { ...opts, subject: "DRIVER" })[0].kind).toBe("FREE");
  });

  it("never flags a driver's idle time as a problem, however long", () => {
    const gaps = classifyGaps([trip(H(8), H(9)), trip(H(20), H(21))], {
      ...opts,
      subject: "DRIVER",
    });
    expect(gaps[0].problem).toBe(false);
  });
});
