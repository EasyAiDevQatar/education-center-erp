import "server-only";
import { db } from "@/lib/db";
import { notifySession } from "@/lib/integrations/notify";
import {
  applyPackageHours,
  attendanceBillablePolicy,
  clearBillableSessionSnapshot,
  noShowPolicy,
  revertPackageHours,
  snapshotBillableSession,
  syncSessionPaymentStatus,
} from "@/lib/billing";
import {
  canApplyAttendanceMark,
  canCheckIn,
  canCheckOut,
} from "@/lib/session-lifecycle";
import { elapsedMinutes } from "@/lib/session-time";

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

  const policy = mark === "SCHEDULED" ? null : await attendanceBillablePolicy();
  const chargeNoShow = mark === "NO_SHOW" && (await noShowPolicy()) === "TAUGHT";

  await db.$transaction(async (tx) => {
    const becomesBillable = mark === "COMPLETED" || chargeNoShow;

    await tx.session.update({
      where: { id: sessionId },
      data: {
        status: mark,
        autoCompleted: mark === "COMPLETED" ? auto : false,
        ...(mark === "SCHEDULED"
          ? {
              studentCheckInAt: null,
              studentCheckOutAt: null,
              teacherCheckInAt: null,
              checkInMethod: null,
              checkInLat: null,
              checkInLng: null,
              actualHours: null,
            }
          : {}),
      },
    });

    if (becomesBillable && policy) {
      // A no-show billed as taught is always the booked duration; there is no
      // arrival/departure measurement to apply an actual-time policy to.
      await snapshotBillableSession(tx, sessionId, policy, { forcePlanned: chargeNoShow });
      await applyPackageHours(tx, sessionId);
    } else {
      // Revert before clearing the snapshot: package drawdown must subtract
      // the same duration that was originally added.
      await revertPackageHours(tx, sessionId);
      await clearBillableSessionSnapshot(tx, sessionId);
    }
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
 * The measured duration is stored to the nearest minute. A separate billable
 * snapshot applies the centre's financial policy without changing that fact.
 */
export async function markCheckedOut(
  sessionId: string,
  at: Date = new Date(),
): Promise<boolean> {
  const session = await db.session.findUnique({ where: { id: sessionId } });
  if (!session) return false;
  if (!canCheckOut(session.status, session.studentCheckInAt, at)) return false;
  const policy = await attendanceBillablePolicy();

  let actualHours: number | null = null;
  if (session.studentCheckInAt) {
    actualHours = elapsedMinutes(session.studentCheckInAt, at) / 60;
  }

  await db.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: sessionId },
      data: { status: "COMPLETED", studentCheckOutAt: at, actualHours },
    });
    await snapshotBillableSession(tx, sessionId, policy, {
      actualMinutes: session.studentCheckInAt
        ? elapsedMinutes(session.studentCheckInAt, at)
        : null,
    });
    await applyPackageHours(tx, sessionId);
    await syncSessionPaymentStatus(tx, sessionId);
  });
  await notifySession("CHECKED_OUT", sessionId);
  return true;
}
