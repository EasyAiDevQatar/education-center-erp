// Suggesting a fix for a scheduling clash.
//
// Pure module — builds on lib/conflicts.ts, no DB — so "move to 17:30" or
// "give it to نجلاء" is computed deterministically and unit-tested. The rules
// here only ever PROPOSE; the office still accepts or ignores, exactly as with
// the warnings themselves.

import { findConflicts, type AvailabilityWindow, type BusySession } from "./conflicts";

/** Whether a slot is clean for EVERY student with the given teacher. */
export function slotIsClean(args: {
  teacherId: string;
  studentIds: string[];
  startMin: number;
  hours: number;
  weekday: number;
  existing: BusySession[];
  availability?: AvailabilityWindow[];
  excludeId?: string | null;
}): boolean {
  const { teacherId, studentIds, startMin, hours, weekday, existing, availability, excludeId } = args;
  return studentIds.every(
    (studentId) =>
      findConflicts({
        candidate: { id: excludeId ?? null, teacherId, studentId, weekday, startMin, hours },
        existing,
        availability,
      }).length === 0,
  );
}

const DEFAULT_FROM = 7 * 60; // 07:00
const DEFAULT_TO = 22 * 60; // last start that still ends by 23:00 for a 1h class
const STEP = 15;

/**
 * The nearest start time, same day and same teacher, that clears the clash for
 * every student.
 *
 * Searches outward from the requested time so the suggestion is a small nudge,
 * not a jump to the morning; ties prefer the LATER slot, because the earlier
 * one is often already in the past. Returns null when the day has no clean slot
 * — better an honest "no free time" than a fake one.
 */
export function suggestFreeStart(args: {
  preferMin: number;
  hours: number;
  teacherId: string;
  studentIds: string[];
  weekday: number;
  existing: BusySession[];
  availability?: AvailabilityWindow[];
  excludeId?: string | null;
  fromMin?: number;
  toMin?: number;
  stepMin?: number;
}): number | null {
  const {
    preferMin, hours, teacherId, studentIds, weekday, existing, availability, excludeId,
    fromMin = DEFAULT_FROM, toMin = DEFAULT_TO, stepMin = STEP,
  } = args;

  const clean = (startMin: number) =>
    slotIsClean({ teacherId, studentIds, startMin, hours, weekday, existing, availability, excludeId });

  // Snap the anchor to the grid so candidates line up with real slots.
  const anchor = Math.round(preferMin / stepMin) * stepMin;
  const maxSpan = toMin - fromMin;

  for (let delta = 0; delta <= maxSpan; delta += stepMin) {
    // Later first on a tie, then earlier.
    for (const cand of delta === 0 ? [anchor] : [anchor + delta, anchor - delta]) {
      if (cand < fromMin || cand > toMin) continue;
      if (cand === preferMin) continue; // the clashing slot itself
      if (clean(cand)) return cand;
    }
  }
  return null;
}

export type TeacherOption = {
  teacherId: string;
  availability?: AvailabilityWindow[];
};

/**
 * A teacher who is free at the ORIGINAL time and settles the clash.
 *
 * Only meaningful when the clash is the teacher being busy or off-shift —
 * swapping teacher cannot fix a STUDENT already booked elsewhere at that time,
 * so a slot where a student clashes returns null and the UI should offer a time
 * move instead. Candidates are tried in the given order (caller sorts, e.g. the
 * student's own teachers first), so the choice is stable.
 */
export function suggestTeacher(args: {
  candidates: TeacherOption[];
  excludeTeacherId: string;
  studentIds: string[];
  startMin: number;
  hours: number;
  weekday: number;
  existing: BusySession[];
  excludeId?: string | null;
}): string | null {
  const { candidates, excludeTeacherId, studentIds, startMin, hours, weekday, existing, excludeId } = args;

  // If any student is already busy at this time, no teacher swap helps.
  const studentBusy = studentIds.some((studentId) =>
    findConflicts({
      candidate: { id: excludeId ?? null, teacherId: excludeTeacherId, studentId, weekday, startMin, hours },
      existing,
    }).some((c) => c.kind === "STUDENT_BUSY"),
  );
  if (studentBusy) return null;

  for (const cand of candidates) {
    if (cand.teacherId === excludeTeacherId) continue;
    const ok = slotIsClean({
      teacherId: cand.teacherId,
      studentIds,
      startMin,
      hours,
      weekday,
      existing,
      availability: cand.availability,
      excludeId,
    });
    if (ok) return cand.teacherId;
  }
  return null;
}