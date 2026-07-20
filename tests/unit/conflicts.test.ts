import { describe, it, expect } from "vitest";
import {
  findConflicts,
  weekdayOf,
  normalizeWindows,
  type BusySession,
  type AvailabilityWindow,
} from "@/lib/conflicts";

const SAT = 6;

function busy(over: Partial<BusySession> = {}): BusySession {
  return {
    id: "s1",
    teacherId: "t1",
    studentId: "st1",
    startMin: 14 * 60,
    hours: 1,
    status: "SCHEDULED",
    studentName: "فهد",
    teacherName: "حنان",
    ...over,
  };
}

const candidate = {
  teacherId: "t1",
  studentId: "st9",
  weekday: SAT,
  startMin: 14 * 60,
  hours: 1,
};

describe("findConflicts — overlaps", () => {
  it("reports nothing when the day is empty", () => {
    expect(findConflicts({ candidate, existing: [] })).toEqual([]);
  });

  it("flags a teacher already booked in the same window", () => {
    const res = findConflicts({ candidate, existing: [busy()] });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ kind: "TEACHER_BUSY", sessionId: "s1", withName: "فهد" });
  });

  it("flags a student already booked with a different teacher", () => {
    const res = findConflicts({
      candidate,
      existing: [busy({ teacherId: "t2", studentId: "st9" })],
    });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ kind: "STUDENT_BUSY", withName: "حنان" });
  });

  it("reports a same-teacher-same-student clash only once", () => {
    const res = findConflicts({
      candidate: { ...candidate, studentId: "st1" },
      existing: [busy()],
    });
    expect(res).toHaveLength(1);
    expect(res[0].kind).toBe("TEACHER_BUSY");
  });

  it("treats back-to-back sessions as clash-free", () => {
    // existing 14:00–15:00, candidate 15:00–16:00
    const res = findConflicts({
      candidate: { ...candidate, startMin: 15 * 60 },
      existing: [busy()],
    });
    expect(res).toEqual([]);
  });

  it("catches a partial overlap in either direction", () => {
    // existing 14:00–15:00, candidate 14:30–15:30
    expect(
      findConflicts({ candidate: { ...candidate, startMin: 14 * 60 + 30 }, existing: [busy()] }),
    ).toHaveLength(1);
    // existing 14:00–15:00, candidate 13:30–14:30
    expect(
      findConflicts({ candidate: { ...candidate, startMin: 13 * 60 + 30 }, existing: [busy()] }),
    ).toHaveLength(1);
  });

  it("ignores cancelled and no-show sessions", () => {
    expect(findConflicts({ candidate, existing: [busy({ status: "CANCELLED" })] })).toEqual([]);
    expect(findConflicts({ candidate, existing: [busy({ status: "NO_SHOW" })] })).toEqual([]);
  });

  it("does not let a session clash with itself when editing", () => {
    const res = findConflicts({
      candidate: { ...candidate, id: "s1" },
      existing: [busy()],
    });
    expect(res).toEqual([]);
  });

  it("still clashes with DRAFT sessions — a planned day is real", () => {
    expect(findConflicts({ candidate, existing: [busy({ status: "DRAFT" })] })).toHaveLength(1);
  });
});

describe("findConflicts — availability", () => {
  const windows: AvailabilityWindow[] = [
    { weekday: SAT, startMin: 14 * 60, endMin: 18 * 60 },
  ];

  it("stays silent for a teacher with no windows configured (opt-in)", () => {
    const res = findConflicts({
      candidate: { ...candidate, startMin: 3 * 60 },
      existing: [],
      availability: [],
    });
    expect(res).toEqual([]);
  });

  it("accepts a booking fully inside a window", () => {
    expect(findConflicts({ candidate, existing: [], availability: windows })).toEqual([]);
  });

  it("warns when the session runs past the end of the window", () => {
    // 17:30–18:30 spills over an 18:00 finish
    const res = findConflicts({
      candidate: { ...candidate, startMin: 17 * 60 + 30 },
      existing: [],
      availability: windows,
    });
    expect(res).toHaveLength(1);
    expect(res[0].kind).toBe("OUTSIDE_AVAILABILITY");
  });

  it("warns on a weekday the teacher has no window for", () => {
    const res = findConflicts({
      candidate: { ...candidate, weekday: 1 },
      existing: [],
      availability: windows,
    });
    expect(res).toHaveLength(1);
    expect(res[0].kind).toBe("OUTSIDE_AVAILABILITY");
  });

  it("accepts a booking inside the second of two windows the same day", () => {
    const split: AvailabilityWindow[] = [
      { weekday: SAT, startMin: 9 * 60, endMin: 12 * 60 },
      { weekday: SAT, startMin: 16 * 60, endMin: 20 * 60 },
    ];
    const res = findConflicts({
      candidate: { ...candidate, startMin: 17 * 60 },
      existing: [],
      availability: split,
    });
    expect(res).toEqual([]);
  });

  it("warns for a booking in the gap between two windows", () => {
    const split: AvailabilityWindow[] = [
      { weekday: SAT, startMin: 9 * 60, endMin: 12 * 60 },
      { weekday: SAT, startMin: 16 * 60, endMin: 20 * 60 },
    ];
    const res = findConflicts({
      candidate: { ...candidate, startMin: 13 * 60 },
      existing: [],
      availability: split,
    });
    expect(res).toHaveLength(1);
  });

  it("reports an overlap and an availability breach together", () => {
    const res = findConflicts({
      candidate: { ...candidate, startMin: 20 * 60 },
      existing: [busy({ startMin: 20 * 60 })],
      availability: windows,
    });
    expect(res.map((c) => c.kind).sort()).toEqual(["OUTSIDE_AVAILABILITY", "TEACHER_BUSY"]);
  });
});

describe("weekdayOf", () => {
  it("reads the weekday as UTC, matching the session-time convention", () => {
    expect(weekdayOf("2026-07-18")).toBe(6); // Saturday
    expect(weekdayOf("2026-07-20")).toBe(1); // Monday
  });
});

describe("normalizeWindows", () => {
  it("drops zero-length and inverted windows", () => {
    expect(
      normalizeWindows([
        { startMin: 600, endMin: 600 },
        { startMin: 800, endMin: 700 },
      ]),
    ).toEqual([]);
  });

  it("merges overlapping and touching windows", () => {
    expect(
      normalizeWindows([
        { startMin: 540, endMin: 720 },
        { startMin: 700, endMin: 780 },
        { startMin: 780, endMin: 840 },
      ]),
    ).toEqual([{ startMin: 540, endMin: 840 }]);
  });

  it("keeps genuinely separate windows and sorts them", () => {
    expect(
      normalizeWindows([
        { startMin: 960, endMin: 1200 },
        { startMin: 540, endMin: 720 },
      ]),
    ).toEqual([
      { startMin: 540, endMin: 720 },
      { startMin: 960, endMin: 1200 },
    ]);
  });
});
