import { describe, expect, it } from "vitest";
import { slotIsClean, suggestFreeStart, suggestTeacher } from "@/lib/conflict-suggest";
import type { BusySession } from "@/lib/conflicts";

const busy = (over: Partial<BusySession> & { id: string }): BusySession => ({
  teacherId: "t1",
  studentId: "s1",
  startMin: 16 * 60,
  hours: 1,
  status: "SCHEDULED",
  ...over,
});

const H = (h: number, m = 0) => h * 60 + m;

describe("slotIsClean", () => {
  it("is clean when nothing overlaps", () => {
    expect(
      slotIsClean({
        teacherId: "t1", studentIds: ["s1"], startMin: H(10), hours: 1, weekday: 1,
        existing: [busy({ id: "a", startMin: H(16) })],
      }),
    ).toBe(true);
  });

  it("is dirty when the teacher is already booked", () => {
    expect(
      slotIsClean({
        teacherId: "t1", studentIds: ["s2"], startMin: H(16), hours: 1, weekday: 1,
        existing: [busy({ id: "a", studentId: "other" })],
      }),
    ).toBe(false);
  });
});

describe("suggestFreeStart", () => {
  it("nudges to the nearest free slot, preferring later on a tie", () => {
    // Teacher busy 16:00-17:00. The requested 16:00 clashes; 17:00 is the
    // nearest clean slot after, 15:00 the nearest before — later wins the tie.
    const r = suggestFreeStart({
      preferMin: H(16), hours: 1, teacherId: "t1", studentIds: ["s2"], weekday: 1,
      existing: [busy({ id: "a", studentId: "other", startMin: H(16) })],
    });
    expect(r).toBe(H(17));
  });

  it("prefers the later slot when both sides are equally near", () => {
    // Busy 16:00-18:00. From 16:30 the nearest clean starts are 15:00 and
    // 18:00, both 90 min away — later wins.
    const r = suggestFreeStart({
      preferMin: H(16, 30), hours: 1, teacherId: "t1", studentIds: ["s2"], weekday: 1,
      existing: [busy({ id: "a", studentId: "other", startMin: H(16), hours: 2 })],
    });
    expect(r).toBe(H(18));
  });

  it("finds an earlier slot when the later side is blocked further out", () => {
    // Busy 16:30-19:00. 16:00 (ends 17:00) still overlaps, so the nearest clean
    // start is 15:30 (ends 16:30, touching but not overlapping); 19:00 is
    // further, so earlier wins.
    const r = suggestFreeStart({
      preferMin: H(16, 45), hours: 1, teacherId: "t1", studentIds: ["s2"], weekday: 1,
      existing: [busy({ id: "a", studentId: "other", startMin: H(16, 30), hours: 2.5 })],
    });
    expect(r).toBe(H(15, 30));
  });

  it("respects the teacher's availability window", () => {
    // Available only 09:00-11:00 on weekday 1; the 16:00 request must land there.
    const r = suggestFreeStart({
      preferMin: H(16), hours: 1, teacherId: "t1", studentIds: ["s2"], weekday: 1,
      existing: [],
      availability: [{ weekday: 1, startMin: H(9), endMin: H(11) }],
    });
    expect(r).not.toBeNull();
    expect(r! >= H(9) && r! + 60 <= H(11)).toBe(true);
  });

  it("returns null when the whole day is blocked", () => {
    // One student booked with a different teacher across every candidate slot.
    const wall: BusySession[] = [
      busy({ id: "w", studentId: "s2", teacherId: "other", startMin: H(7), hours: 16 }),
    ];
    const r = suggestFreeStart({
      preferMin: H(16), hours: 1, teacherId: "t1", studentIds: ["s2"], weekday: 1, existing: wall,
    });
    expect(r).toBeNull();
  });

  it("clears the clash for every student, not just one", () => {
    const existing = [
      busy({ id: "a", teacherId: "t1", studentId: "x", startMin: H(16) }), // teacher busy
      busy({ id: "b", teacherId: "z", studentId: "s2", startMin: H(17) }), // s2 busy 17:00
    ];
    const r = suggestFreeStart({
      preferMin: H(16), hours: 1, teacherId: "t1", studentIds: ["s2", "s3"], weekday: 1, existing,
    });
    // 17:00 is out (s2 busy), so the nearest clean is 15:00.
    expect(r).toBe(H(15));
  });
});

describe("suggestTeacher", () => {
  const students = ["s2"];

  it("picks a free teacher at the same time", () => {
    const existing = [busy({ id: "a", teacherId: "t1", studentId: "other", startMin: H(16) })];
    const r = suggestTeacher({
      candidates: [{ teacherId: "t1" }, { teacherId: "t2" }],
      excludeTeacherId: "t1", studentIds: students, startMin: H(16), hours: 1, weekday: 1, existing,
    });
    expect(r).toBe("t2");
  });

  it("returns null when a STUDENT is the clash — a teacher swap cannot fix that", () => {
    const existing = [busy({ id: "a", teacherId: "z", studentId: "s2", startMin: H(16) })];
    const r = suggestTeacher({
      candidates: [{ teacherId: "t2" }, { teacherId: "t3" }],
      excludeTeacherId: "t1", studentIds: students, startMin: H(16), hours: 1, weekday: 1, existing,
    });
    expect(r).toBeNull();
  });

  it("skips a candidate who is also busy, and one off-shift", () => {
    const existing = [
      busy({ id: "a", teacherId: "t1", studentId: "other", startMin: H(16) }),
      busy({ id: "b", teacherId: "t2", studentId: "another", startMin: H(16) }),
    ];
    const r = suggestTeacher({
      candidates: [
        { teacherId: "t2" }, // busy
        { teacherId: "t3", availability: [{ weekday: 1, startMin: H(9), endMin: H(11) }] }, // off-shift at 16:00
        { teacherId: "t4" }, // free
      ],
      excludeTeacherId: "t1", studentIds: students, startMin: H(16), hours: 1, weekday: 1, existing,
    });
    expect(r).toBe("t4");
  });

  it("honours candidate order so the choice is stable", () => {
    const r = suggestTeacher({
      candidates: [{ teacherId: "tB" }, { teacherId: "tA" }],
      excludeTeacherId: "t1", studentIds: students, startMin: H(16), hours: 1, weekday: 1, existing: [],
    });
    expect(r).toBe("tB");
  });

  it("returns null when no other teacher is free", () => {
    const existing = [
      busy({ id: "a", teacherId: "t2", studentId: "x", startMin: H(16) }),
    ];
    const r = suggestTeacher({
      candidates: [{ teacherId: "t2" }],
      excludeTeacherId: "t1", studentIds: students, startMin: H(16), hours: 1, weekday: 1, existing,
    });
    expect(r).toBeNull();
  });
});