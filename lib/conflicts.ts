/** Pure scheduling-conflict detection (no DB access — unit tested).
 *
 * Conflicts are **advisory**. Every caller surfaces them as warnings and still
 * lets the user save: a centre routinely double-books on purpose (a teacher
 * supervising two students in one room, a make-up lesson squeezed into a gap),
 * so blocking would fight the way the office actually works.
 *
 * Times are minutes from midnight, matching `lib/planner.ts` and the
 * wall-clock-as-UTC convention used for `Session.date`.
 */

export type ConflictKind =
  /** The teacher already has an overlapping session. */
  | "TEACHER_BUSY"
  /** The student already has an overlapping session. */
  | "STUDENT_BUSY"
  /** Falls outside the teacher's configured weekly availability. */
  | "OUTSIDE_AVAILABILITY";

export type Conflict = {
  kind: ConflictKind;
  /** The clashing session, when the conflict is an overlap. */
  sessionId?: string;
  /** Who/what it clashes with, ready to interpolate into a message. */
  withName?: string;
  startMin?: number;
  hours?: number;
};

export type BusySession = {
  id: string;
  /** Null for a walk-in recorded before a teacher was assigned. */
  teacherId: string | null;
  studentId: string;
  startMin: number;
  hours: number;
  status: string;
  /** Student name for TEACHER_BUSY, teacher name for STUDENT_BUSY. */
  studentName?: string;
  teacherName?: string;
};

export type AvailabilityWindow = {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  startMin: number;
  endMin: number;
};

export type Candidate = {
  /** Set when editing an existing session so it can't clash with itself. */
  id?: string | null;
  teacherId: string;
  studentId: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  startMin: number;
  hours: number;
};

/** Statuses that no longer occupy the calendar and so can't be clashed with. */
const INERT = new Set(["CANCELLED", "NO_SHOW"]);

/** Half-open overlap: sessions that merely touch end-to-start do not clash. */
function overlaps(aStart: number, aHours: number, bStart: number, bHours: number): boolean {
  const aEnd = aStart + aHours * 60;
  const bEnd = bStart + bHours * 60;
  return aStart < bEnd && bStart < aEnd;
}

/** Does `[startMin, startMin+hours)` sit entirely inside one of the windows? */
function insideAnyWindow(
  startMin: number,
  hours: number,
  windows: AvailabilityWindow[],
): boolean {
  const end = startMin + hours * 60;
  return windows.some((w) => startMin >= w.startMin && end <= w.endMin);
}

/**
 * Find every advisory conflict for a candidate booking.
 *
 * `availability` is the teacher's full set of weekly windows. A teacher with no
 * windows configured is treated as always available, so the check stays opt-in
 * and existing teachers don't suddenly start warning on every booking.
 */
export function findConflicts({
  candidate,
  existing,
  availability = [],
}: {
  candidate: Candidate;
  existing: BusySession[];
  availability?: AvailabilityWindow[];
}): Conflict[] {
  const out: Conflict[] = [];
  const { id, teacherId, studentId, startMin, hours, weekday } = candidate;

  for (const s of existing) {
    if (s.id === id) continue; // editing itself
    if (INERT.has(s.status)) continue;
    if (!overlaps(startMin, hours, s.startMin, s.hours)) continue;

    if (s.teacherId === teacherId) {
      out.push({
        kind: "TEACHER_BUSY",
        sessionId: s.id,
        withName: s.studentName,
        startMin: s.startMin,
        hours: s.hours,
      });
    }
    // A student booked with the same teacher at the same time is one clash, not
    // two — the teacher warning already says everything useful.
    if (s.studentId === studentId && s.teacherId !== teacherId) {
      out.push({
        kind: "STUDENT_BUSY",
        sessionId: s.id,
        withName: s.teacherName,
        startMin: s.startMin,
        hours: s.hours,
      });
    }
  }

  if (availability.length > 0) {
    const dayWindows = availability.filter((w) => w.weekday === weekday);
    // No window on this weekday = the teacher's day off, which is still just a
    // warning (cover lessons happen).
    if (!insideAnyWindow(startMin, hours, dayWindows)) {
      out.push({ kind: "OUTSIDE_AVAILABILITY", startMin, hours });
    }
  }

  return out;
}

/** Weekday of a `YYYY-MM-DD` day string under the wall-clock-as-UTC convention. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

/** Gulf week order — Saturday first, matching the calendar and the paper sheet. */
export const WEEKDAY_ORDER = [6, 0, 1, 2, 3, 4, 5] as const;

/** Merge overlapping/adjacent windows so an editor can't store nonsense. */
export function normalizeWindows(
  windows: { startMin: number; endMin: number }[],
): { startMin: number; endMin: number }[] {
  const valid = windows
    .filter((w) => w.endMin > w.startMin)
    .sort((a, b) => a.startMin - b.startMin);

  const out: { startMin: number; endMin: number }[] = [];
  for (const w of valid) {
    const last = out[out.length - 1];
    if (last && w.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, w.endMin);
    } else {
      out.push({ ...w });
    }
  }
  return out;
}
