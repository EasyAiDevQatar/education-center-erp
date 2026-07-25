import { describe, it, expect } from "vitest";
import {
  isDraggable,
  lockReasonFor,
  proposedResize,
  proposedTimes,
  hoursOf,
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
  hasStarted: true,
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

  it("does NOT believe a future lesson that claims to be finished", () => {
    // Seeded and imported data does this. A lesson next week marked COMPLETED
    // is bad data, and locking it repeats the error back as a rule.
    for (const status of ["COMPLETED", "CHECKED_IN"]) {
      expect(lockReasonFor(subject({ status, hasStarted: false }), scheduler)).toBeNull();
      expect(lockReasonFor(subject({ status, hasStarted: true }), scheduler)).toBe(
        "ALREADY_HAPPENED",
      );
    }
  });

  it("still refuses a cancelled lesson whatever the clock says", () => {
    for (const status of ["CANCELLED", "NO_SHOW"]) {
      expect(lockReasonFor(subject({ status, hasStarted: false }), scheduler)).toBe(
        "ALREADY_HAPPENED",
      );
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

describe("proposedResize", () => {
  const axis = { minMin: H(14), maxMin: H(22) };
  const lesson = { startMin: H(16), endMin: H(17) };

  it("moves only the edge being dragged", () => {
    expect(proposedResize(lesson, "to", 30, axis)).toEqual({ startMin: H(16), endMin: H(17, 30) });
    expect(proposedResize(lesson, "from", -30, axis)).toEqual({ startMin: H(15, 30), endMin: H(17) });
  });

  it("refuses to shrink a lesson away", () => {
    // Dragging the end back past the start leaves the shortest bookable lesson.
    expect(proposedResize(lesson, "to", -600, axis).endMin).toBe(H(16, 15));
    expect(proposedResize(lesson, "from", 600, axis).startMin).toBe(H(16, 45));
  });

  it("honours a longer minimum, so a part-paid lesson cannot be cut below it", () => {
    const p = proposedResize(lesson, "to", -600, axis, { minDurationMin: 45 });
    expect(p.endMin).toBe(H(16, 45));
  });

  it("caps growth at the maximum the booking schema accepts", () => {
    const long = proposedResize({ startMin: H(14), endMin: H(15) }, "to", 20 * 60, axis, {
      maxDurationMin: 12 * 60,
    });
    // 12h from 14:00 would be 02:00; the axis ends first and wins.
    expect(long.endMin).toBe(H(22));
  });

  it("cannot be dragged off either end of the axis", () => {
    expect(proposedResize({ startMin: H(15), endMin: H(16) }, "from", -600, axis).startMin).toBe(H(14));
    expect(proposedResize({ startMin: H(20), endMin: H(21) }, "to", 600, axis).endMin).toBe(H(22));
  });

  it("snaps to the quarter hour, so hours stay expressible", () => {
    const p = proposedResize(lesson, "to", 7, axis);
    expect(p.endMin).toBe(H(17));
    expect(hoursOf(p.startMin, p.endMin)).toBe(1);
    expect(hoursOf(H(16), H(17, 15))).toBe(1.25);
    expect(hoursOf(H(16), H(16, 45))).toBe(0.75);
  });
});
