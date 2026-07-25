import { describe, it, expect } from "vitest";
import {
  isDraggable,
  lockReasonFor,
  proposedTimes,
  snapMinutes,
  type DragPolicy,
  type DragSubject,
} from "@/lib/transport/drag-lock";

const H = (h: number, m = 0) => h * 60 + m;

const subject = (over: Partial<DragSubject> = {}): DragSubject => ({
  status: "SCHEDULED",
  sessionType: "REGULAR",
  conflicts: false,
  tripDispatched: false,
  ...over,
});

const scheduler: DragPolicy = { canDrag: true, lockConflicted: false };
const viewer: DragPolicy = { canDrag: false, lockConflicted: false };

describe("lockReasonFor — what may be moved", () => {
  it("lets an ordinary scheduled lesson be dragged", () => {
    expect(lockReasonFor(subject(), scheduler)).toBeNull();
    expect(isDraggable(subject(), scheduler)).toBe(true);
  });

  it("refuses everything to a user who may only look", () => {
    expect(lockReasonFor(subject(), viewer)).toBe("NOT_PERMITTED");
  });

  it("refuses a lesson that already happened or is happening", () => {
    for (const status of ["COMPLETED", "CHECKED_IN", "CANCELLED", "NO_SHOW"]) {
      expect(lockReasonFor(subject({ status }), scheduler)).toBe("ALREADY_HAPPENED");
    }
  });

  it("refuses an exam or assessment, whatever else is configured", () => {
    for (const sessionType of ["EXAM", "ASSESSMENT"] as const) {
      expect(lockReasonFor(subject({ sessionType }), scheduler)).toBe("STRICT_TYPE");
      // Even when the centre has unlocked everything else it can unlock.
      expect(
        lockReasonFor(subject({ sessionType }), { canDrag: true, lockConflicted: false }),
      ).toBe("STRICT_TYPE");
    }
  });

  it("refuses a lesson whose ride is already on the road", () => {
    expect(lockReasonFor(subject({ tripDispatched: true }), scheduler)).toBe("DISPATCHED");
  });
});

describe("lockReasonFor — the conflicted case is the centre's choice", () => {
  const clashing = subject({ conflicts: true });

  it("allows dragging a clashing lesson by default — that is how you fix it", () => {
    expect(lockReasonFor(clashing, { canDrag: true, lockConflicted: false })).toBeNull();
  });

  it("locks it once the centre asks for that", () => {
    expect(lockReasonFor(clashing, { canDrag: true, lockConflicted: true })).toBe("CONFLICTED");
  });
});

describe("lockReasonFor — the most fundamental reason wins", () => {
  it("reports a completed exam as already happened, not as strict", () => {
    // Both apply; only one explains why it is truly immovable.
    expect(
      lockReasonFor(subject({ status: "COMPLETED", sessionType: "EXAM" }), scheduler),
    ).toBe("ALREADY_HAPPENED");
  });

  it("reports permission before anything about the lesson itself", () => {
    expect(
      lockReasonFor(subject({ status: "COMPLETED", sessionType: "EXAM" }), viewer),
    ).toBe("NOT_PERMITTED");
  });

  it("reports a dispatched exam as strict, since the exam is the harder rule", () => {
    expect(
      lockReasonFor(subject({ sessionType: "EXAM", tripDispatched: true }), scheduler),
    ).toBe("STRICT_TYPE");
  });
});

describe("snapMinutes", () => {
  it("snaps to the quarter hour the office books on", () => {
    expect(snapMinutes(H(16, 7))).toBe(H(16));
    expect(snapMinutes(H(16, 8))).toBe(H(16, 15));
    expect(snapMinutes(H(16, 22))).toBe(H(16, 15)); // 7 min back beats 8 forward
    expect(snapMinutes(H(16, 23))).toBe(H(16, 30)); // and 7 forward beats 8 back
  });

  it("honours a different step", () => {
    expect(snapMinutes(H(16, 7), 30)).toBe(H(16));
    expect(snapMinutes(H(16, 20), 30)).toBe(H(16, 30));
  });
});

describe("proposedTimes", () => {
  const axis = { minMin: H(14), maxMin: H(22) };
  const lesson = { startMin: H(16), endMin: H(17) };

  it("moves a lesson without resizing it", () => {
    const p = proposedTimes(lesson, 30, axis);
    expect(p).toEqual({ startMin: H(16, 30), endMin: H(17, 30) });
  });

  it("snaps a scruffy drag to the grid", () => {
    expect(proposedTimes(lesson, 7, axis).startMin).toBe(H(16));
    expect(proposedTimes(lesson, 8, axis).startMin).toBe(H(16, 15));
  });

  it("cannot be flung off the start of the axis", () => {
    const p = proposedTimes(lesson, -600, axis);
    expect(p.startMin).toBe(H(14));
    expect(p.endMin - p.startMin).toBe(60); // duration preserved
  });

  it("cannot be flung off the end, and stays fully visible", () => {
    const p = proposedTimes(lesson, 600, axis);
    expect(p.endMin).toBe(H(22));
    expect(p.startMin).toBe(H(21));
  });

  it("leaves a lesson alone when it has not moved", () => {
    expect(proposedTimes(lesson, 0, axis)).toEqual(lesson);
  });
});
