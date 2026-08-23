import "server-only";
import { db } from "@/lib/db";
import { notifySession } from "@/lib/integrations/notify";
import { applyPackageHours, revertPackageHours, syncSessionPaymentStatus } from "@/lib/billing";
import {
  canApplyAttendanceMark,
  canCheckIn,
  canCheckOut,
} from "@/lib/session-lifecycle";

/**
 * One way to say a lesson happened.
 *
 * Five screens decide this: the kiosk check-in, a barcode scan, a tap on the
 * roster, "everyone was here", and the daily planner confirming a draft. Each
 * had written its own version — the same status update, the same package
 * drawdown, the same payment sync — and each was free to forget a step. Most
 * of them forgot to tell anybody, which is why a home visit planned on the
 * planner and then confirmed reached the family as silence.
 *
 * It lives in lib/ rather than beside one of those screens so that no screen
 * owns it and every screen has to ask.
 */

export const MARKS = ["COMPLETED", "NO_SHOW", "SCHEDULED"] as const;
export type Mark = (typeof MARKS)[number];

/**
 * Apply an attendance mark, keeping billing and the family in step.
 *
 * COMPLETED is the billable state, so it draws down any package and refreshes
 * payment status; moving back out returns those hours. Both happen in one
 * transaction, so a half-applied mark is impossible.
 *
 * Re-marking the same status returns early, which makes repeat taps free and —
 * more importantly — means a student who is already marked present cannot be
 * announced twice.
 *
 * `auto` is the clock rather than a person: auto-completion sweeps every
 * unclosed session at the end of the day and must not message anybody.
 */
export async function applyMark(sessionId: string, mark: Mark, auto = false): Promise<boolean> {
  const existing = await db.session.findUnique({ where: { id: sessionId } });
  if (!existing) return false;
  if (existing.status === mark) return true;
  if (!canApplyAttendanceMark(existing.status, mark)) return false;

  await db.$transaction(async (tx) => {
    const wasCompleted = existing.status === "COMPLETED";
    const willComplete = mark === "COMPLETED";

    await tx.session.update({
      where: { id: sessionId },
      data: {
        status: mark,
        autoCompleted: willComplete ? auto : false,
      },
    });

    if (willComplete && !wasCompleted) await applyPackageHours(tx, sessionId);
    // Not just from COMPLETED: `packageApplied` is the record of what is held,
    // and revert is a no-op when nothing is, so releasing on any move out of a
    // billable state is both correct and cheap.
    else if (!willComplete) await revertPackageHours(tx, sessionId);
    await syncSessionPaymentStatus(tx, sessionId);
  });

  // SCHEDULED means somebody undid a mark, which is a correction rather than
  // news, so it says nothing.
  if (!auto) {
    if (mark === "COMPLETED") await notifySession("CHECKED_IN", sessionId);
    else if (mark === "NO_SHOW") await notifySession("SESSION_NO_SHOW", sessionId);
  }
  return true;
}

/**
 * The student is here.
 *
 * Separate from applyMark because CHECKED_IN is not an attendance verdict —
 * it is the middle of one. The verdict comes at check-out, when the duration
 * is known.
 */
export async function markCheckedIn(
  sessionId: string,
  method: string,
  at: Date = new Date(),
): Promise<boolean> {
  const session = await db.session.findUnique({ where: { id: sessionId } });
  if (!session) return false;
  if (session.status === "CHECKED_IN") return true;
  if (!canCheckIn(session.status)) return false;

  await db.session.update({
    where: { id: sessionId },
    data: {
      status: "CHECKED_IN",
      // Always the moment of THIS check-in. Keeping an older one looks
      // harmless until a session is undone and checked in again: the measured
      // duration would then run from the first arrival, and check-out bills
      // hours nobody taught.
      studentCheckInAt: at,
      checkInMethod: method,
      // A real arrival resolves a nightly "no attendance recorded" flag,
      // whether it came from this list, the kiosk, GPS, or a QR scan.
      autoCompleted: false,
    },
  });
  await notifySession("CHECKED_IN", sessionId);
  return true;
}

/**
 * The student has left, and the lesson is now billable.
 *
 * The measured duration is snapped to a quarter hour: a centre bills in
 * quarters and a raw millisecond difference would put 57 minutes on an
 * invoice. Package drawdown happens here rather than at check-in because a
 * lesson that was started and abandoned should not consume hours.
 */
export async function markCheckedOut(
  sessionId: string,
  at: Date = new Date(),
): Promise<boolean> {
  const session = await db.session.findUnique({ where: { id: sessionId } });
  if (!session) return false;
  if (!canCheckOut(session.status, session.studentCheckInAt, at)) return false;

  let actualHours: number | null = null;
  if (session.studentCheckInAt) {
    const ms = at.getTime() - session.studentCheckInAt.getTime();
    actualHours = Math.max(0.25, Math.round((ms / 3_600_000) * 4) / 4);
  }

  await db.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: sessionId },
      data: { status: "COMPLETED", studentCheckOutAt: at, actualHours },
    });
    await applyPackageHours(tx, sessionId);
    await syncSessionPaymentStatus(tx, sessionId);
  });
  await notifySession("CHECKED_OUT", sessionId);
  return true;
}
