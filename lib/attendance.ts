import "server-only";
import { db } from "@/lib/db";
import { notifySession } from "@/lib/integrations/notify";
import { applyPackageHours, revertPackageHours, syncSessionPaymentStatus } from "@/lib/billing";

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

  await db.$transaction(async (tx) => {
    const wasCompleted = existing.status === "COMPLETED";
    const willComplete = mark === "COMPLETED";

    await tx.session.update({
      where: { id: sessionId },
      data: {
        status: mark,
        autoCompleted: willComplete ? auto : false,
        studentCheckInAt:
          willComplete && !existing.studentCheckInAt && !auto
            ? new Date()
            : existing.studentCheckInAt,
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
