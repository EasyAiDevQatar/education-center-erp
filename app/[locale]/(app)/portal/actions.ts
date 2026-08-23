"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { applyMark } from "@/lib/attendance";

export type PortalState = { ok?: boolean; error?: string };

/**
 * A teacher confirming their own lesson as taught.
 *
 * Two gates, both required: the centre setting must be on, and the session must
 * belong to the caller. The ownership check reads the teacher id from the JWT,
 * never from the request, so a teacher cannot confirm someone else's lesson by
 * guessing an id.
 */
export async function confirmOwnSession(
  locale: string,
  sessionId: string,
): Promise<PortalState> {
  const s = await getSession();
  if (!s?.teacherId) return { error: "forbidden" };

  const setting = await db.setting.findUnique({ where: { key: "teacherCanConfirm" } });
  if (setting?.value !== "true") return { error: "notAllowed" };

  const target = await db.session.findUnique({ where: { id: sessionId } });
  if (!target) return { error: "notfound" };
  if (target.teacherId !== s.teacherId) return { error: "forbidden" };
  if (target.status !== "DRAFT") return { error: "notDraft" };

  if (!(await applyMark(sessionId, "COMPLETED"))) return { error: "notDraft" };

  await writeAudit("Session", sessionId, "UPDATE", {
    after: { status: "COMPLETED", confirmedBy: "teacherPortal" },
  });
  revalidatePath(`/${locale}/portal/teacher`);
  return { ok: true };
}
