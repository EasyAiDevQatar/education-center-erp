import type { SessionStatus } from "./enums";

/** Door scans close only after this guard, so one card held under the camera
 * cannot check a student in and immediately back out. */
export const MIN_CHECKOUT_MS = 60_000;

export function canCheckIn(status: string): boolean {
  return status === "SCHEDULED";
}

export function canCheckOut(
  status: string,
  checkedInAt: Date | null,
  at: Date = new Date(),
): boolean {
  return (
    status === "CHECKED_IN" &&
    checkedInAt !== null &&
    at.getTime() - checkedInAt.getTime() >= MIN_CHECKOUT_MS
  );
}

/** Attendance corrections may reopen only sessions that received an
 * attendance decision. Drafts were never confirmed, scheduled sessions have
 * nothing to undo, and cancelled sessions are terminal. */
export function canUndoAttendance(status: string): boolean {
  return status === "CHECKED_IN" || status === "COMPLETED" || status === "NO_SHOW";
}

/** Cancellation is an administrative decision made before teaching starts.
 * Completed, absent, and in-progress lessons must first be corrected through
 * the attendance workflow so history cannot be erased with one click. */
export function canCancelSession(status: string): boolean {
  return status === "DRAFT" || status === "SCHEDULED";
}

/** Roster corrections are intentionally narrow. CANCELLED is terminal and can
 * never be revived by a stale attendance button or QR request. */
export function canApplyAttendanceMark(from: string, to: SessionStatus): boolean {
  if (from === to) return true;
  if (from === "CANCELLED") return false;
  if (to === "SCHEDULED") {
    return from === "CHECKED_IN" || from === "COMPLETED" || from === "NO_SHOW";
  }
  if (to === "COMPLETED") {
    return from === "DRAFT" || from === "SCHEDULED" || from === "CHECKED_IN";
  }
  if (to === "NO_SHOW") return from === "SCHEDULED" || from === "CHECKED_IN";
  return false;
}
