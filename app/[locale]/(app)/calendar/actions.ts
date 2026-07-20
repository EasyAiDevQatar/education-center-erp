"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { toNumber } from "@/lib/money";
import { combineDateTime } from "@/lib/session-time";

export type ActionState = { ok?: boolean; error?: string };

async function guard() {
  const s = await getSession();
  return !s || !STAFF_ROLES.includes(s.role);
}

const rescheduleSchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  teacherId: z.string().optional().nullable(),
});

/** Move a session to a new start date/time (and optionally a new teacher column). */
export async function rescheduleSession(
  locale: string,
  input: z.infer<typeof rescheduleSchema>,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const { id, date, time, teacherId } = parsed.data;

  const data: { date: Date; teacherId?: string } = {
    date: combineDateTime(date, time),
  };
  if (teacherId) data.teacherId = teacherId;

  await db.session.update({ where: { id }, data });
  await writeAudit("Session", id, "UPDATE", { after: data });
  revalidatePath(`/${locale}/calendar`);
  revalidatePath(`/${locale}/sessions`);
  return { ok: true };
}

const resizeSchema = z.object({
  id: z.string().min(1),
  hours: z.coerce.number().min(0.25).max(12),
});

/** Change a session's planned duration; total is recomputed from its snapshotted price. */
export async function resizeSession(
  locale: string,
  input: z.infer<typeof resizeSchema>,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = resizeSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const { id, hours } = parsed.data;

  const existing = await db.session.findUnique({ where: { id } });
  if (!existing) return { error: "notfound" };
  const total = toNumber(existing.pricePerHour) * hours;

  await db.session.update({ where: { id }, data: { hours, total } });
  await writeAudit("Session", id, "UPDATE", { after: { hours, total } });
  revalidatePath(`/${locale}/calendar`);
  revalidatePath(`/${locale}/sessions`);
  return { ok: true };
}
