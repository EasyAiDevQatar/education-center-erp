import { describe, expect, it } from "vitest";
import {
  byTeacher,
  oldestFirst,
  suggestAllocation,
  validateAllocation,
  inferTeacher,
  type PayableSession,
} from "@/lib/allocation";

const s = (over: Partial<PayableSession> & { id: string }): PayableSession => ({
  date: "2026-07-01",
  teacherId: "t1",
  teacherName: "شيرين",
  total: 100,
  allocated: 0,
  outstanding: 100,
  ...over,
});

describe("oldestFirst", () => {
  it("orders by date, then id so runs are reproducible", () => {
    const out = oldestFirst([
      s({ id: "b", date: "2026-07-05" }),
      s({ id: "a", date: "2026-07-01" }),
      s({ id: "c", date: "2026-07-01" }),
    ]);
    expect(out.map((x) => x.id)).toEqual(["a", "c", "b"]);
  });
});

describe("suggestAllocation", () => {
  const three = [
    s({ id: "old", date: "2026-07-01", outstanding: 100 }),
    s({ id: "mid", date: "2026-07-05", outstanding: 150 }),
    s({ id: "new", date: "2026-07-09", outstanding: 200 }),
  ];

  it("settles everything when the payment covers the lot", () => {
    const r = suggestAllocation(three, 450);
    expect(r.allocated).toBe(450);
    expect(r.stillOwing).toBe(0);
    expect(r.unallocated).toBe(0);
    expect(r.coversAll).toBe(true);
    expect(r.lines.every((l) => !l.partial)).toBe(true);
  });

  it("clears the OLDEST debt first when the payment is short", () => {
    // 220 covers the 100 outright and 120 of the 150 — the newest is untouched.
    const r = suggestAllocation(three, 220);
    expect(r.lines).toEqual([
      { sessionId: "old", amount: 100, partial: false },
      { sessionId: "mid", amount: 120, partial: true },
    ]);
    expect(r.stillOwing).toBe(230);
    expect(r.coversAll).toBe(false);
  });

  it("flags the session the money ran out on, so it is not read as settled", () => {
    const r = suggestAllocation(three, 100.5);
    expect(r.lines[1]).toEqual({ sessionId: "mid", amount: 0.5, partial: true });
  });

  it("reports leftover money as unallocated rather than inventing a debt", () => {
    const r = suggestAllocation([s({ id: "only", outstanding: 60 })], 100);
    expect(r.allocated).toBe(60);
    expect(r.unallocated).toBe(40);
    expect(r.stillOwing).toBe(0);
  });

  it("ignores sessions that are already settled", () => {
    const r = suggestAllocation(
      [s({ id: "paid", outstanding: 0, allocated: 100 }), s({ id: "owing", outstanding: 50 })],
      50,
    );
    expect(r.lines).toEqual([{ sessionId: "owing", amount: 50, partial: false }]);
  });

  it("handles a zero or negative payment without producing lines", () => {
    expect(suggestAllocation(three, 0).lines).toEqual([]);
    expect(suggestAllocation(three, -10).lines).toEqual([]);
  });

  it("counts the teachers a payment actually settles for", () => {
    const mixed = [
      s({ id: "a", date: "2026-07-01", teacherId: "t1", outstanding: 100 }),
      s({ id: "b", date: "2026-07-02", teacherId: "t2", outstanding: 100 }),
    ];
    // Only enough for the first teacher.
    expect(suggestAllocation(mixed, 100).teacherCount).toBe(1);
    expect(suggestAllocation(mixed, 200).teacherCount).toBe(2);
  });

  it("does not leave floating-point dust", () => {
    const r = suggestAllocation(
      [s({ id: "a", outstanding: 33.33 }), s({ id: "b", date: "2026-07-02", outstanding: 33.33 })],
      66.66,
    );
    expect(r.allocated).toBe(66.66);
    expect(r.unallocated).toBe(0);
    expect(r.stillOwing).toBe(0);
  });
});

describe("byTeacher", () => {
  const mixed = [
    s({ id: "a", date: "2026-07-01", teacherId: "t1", teacherName: "شيرين", outstanding: 100 }),
    s({ id: "b", date: "2026-07-02", teacherId: "t2", teacherName: "نجلاء", outstanding: 150 }),
    s({ id: "c", date: "2026-07-03", teacherId: "t1", teacherName: "شيرين", outstanding: 50 }),
  ];

  it("rolls sessions up per teacher", () => {
    const r = byTeacher(mixed, suggestAllocation(mixed, 300).lines);
    const t1 = r.find((x) => x.teacherId === "t1")!;
    expect(t1.outstanding).toBe(150);
    expect(t1.allocated).toBe(150);
    expect(t1.sessions).toBe(2);
  });

  it("shows a teacher who got nothing from a short payment", () => {
    // 100 clears only the oldest, which is t1's.
    const r = byTeacher(mixed, suggestAllocation(mixed, 100).lines);
    expect(r.find((x) => x.teacherId === "t2")!.allocated).toBe(0);
    expect(r.find((x) => x.teacherId === "t1")!.allocated).toBe(100);
  });

  it("groups unassigned sessions rather than dropping them", () => {
    const r = byTeacher([s({ id: "x", teacherId: null, teacherName: "" })], []);
    expect(r).toHaveLength(1);
    expect(r[0].teacherId).toBeNull();
  });
});

describe("validateAllocation", () => {
  const one = [s({ id: "a", outstanding: 100 })];

  it("accepts an allocation within both limits", () => {
    expect(validateAllocation(one, [{ sessionId: "a", amount: 60, partial: true }], 100).ok).toBe(true);
  });

  it("refuses to push a session past what it owes", () => {
    const r = validateAllocation(one, [{ sessionId: "a", amount: 140, partial: false }], 200);
    expect(r).toMatchObject({ ok: false, error: "overSession" });
  });

  it("refuses to allocate more than was actually received", () => {
    const two = [...one, s({ id: "b", date: "2026-07-02", outstanding: 100 })];
    const r = validateAllocation(
      two,
      [
        { sessionId: "a", amount: 100, partial: false },
        { sessionId: "b", amount: 100, partial: false },
      ],
      150,
    );
    expect(r).toMatchObject({ ok: false, error: "overPayment" });
  });

  it("rejects a line pointing at a session that is not on the list", () => {
    expect(validateAllocation(one, [{ sessionId: "ghost", amount: 10, partial: false }], 100).ok).toBe(false);
  });
});

describe("inferTeacher", () => {
  it("returns the teacher when every allocated line is theirs", () => {
    const sessions = [s({ id: "a", teacherId: "t1" }), s({ id: "b", teacherId: "t1" })];
    expect(inferTeacher(sessions, [{ sessionId: "a", amount: 50 }, { sessionId: "b", amount: 25 }])).toBe("t1");
  });

  it("returns null for a mixed-teacher split", () => {
    const sessions = [s({ id: "a", teacherId: "t1" }), s({ id: "b", teacherId: "t2" })];
    expect(inferTeacher(sessions, [{ sessionId: "a", amount: 50 }, { sessionId: "b", amount: 25 }])).toBeNull();
  });

  it("ignores zero-amount lines", () => {
    const sessions = [s({ id: "a", teacherId: "t1" }), s({ id: "b", teacherId: "t2" })];
    expect(inferTeacher(sessions, [{ sessionId: "a", amount: 50 }, { sessionId: "b", amount: 0 }])).toBe("t1");
  });

  it("returns null when an allocated session has no teacher", () => {
    const sessions = [s({ id: "a", teacherId: null })];
    expect(inferTeacher(sessions, [{ sessionId: "a", amount: 10 }])).toBeNull();
  });

  it("returns null with no allocation at all", () => {
    expect(inferTeacher([s({ id: "a" })], [])).toBeNull();
  });
});
