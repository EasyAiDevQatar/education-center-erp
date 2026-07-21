"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";

export type AttendanceSettingsState = { ok?: boolean; error?: string };

const schema = z.object({
  /** FLAG | ASSIGN | ASK | NONE — see the check-in scanner for what each does. */
  walkIn: z.enum(["FLAG", "ASSIGN", "ASK", "NONE"]),
  pickSession: z.coerce.boolean(),
  graceHours: z.coerce.number().int().min(0).max(168),
});

export async function saveAttendanceSettings(
  locale: string,
  input: z.infer<typeof schema>,
): Promise<AttendanceSettingsState> {
  const s = await getSession();
  if (!s || s.role !== "ADMIN") return { error: "forbidden" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  for (const [key, value] of [
    ["attendanceWalkIn", d.walkIn],
    ["attendancePickSession", String(d.pickSession)],
    ["autoCompleteGraceHours", String(d.graceHours)],
  ] as const) {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }

  await writeAudit("Setting", "attendance", "UPDATE", { after: d });
  revalidatePath(`/${locale}/settings`);
  revalidatePath(`/${locale}/checkin`);
  return { ok: true };
}

const assignSchema = z.object({
  sessionId: z.string().min(1),
  teacherId: z.string().min(1),
});

/**
 * Give a walk-in session its teacher.
 *
 * The picker is limited to teachers who already worked that day, which is both
 * the realistic set and a guard against crediting someone who wasn't there.
 */
export async function assignSessionTeacher(
  locale: string,
  input: z.infer<typeof assignSchema>,
): Promise<AttendanceSettingsState> {
  const s = await getSession();
  if (!s || !["ADMIN", "ACCOUNTANT", "RECEPTIONIST"].includes(s.role)) {
    return { error: "forbidden" };
  }
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };

  await db.session.update({
    where: { id: parsed.data.sessionId },
    data: { teacherId: parsed.data.teacherId, needsTeacher: false },
  });
  await writeAudit("Session", parsed.data.sessionId, "UPDATE", {
    after: { teacherId: parsed.data.teacherId, assignedAfterWalkIn: true },
  });
  revalidatePath(`/${locale}/checkin`);
  revalidatePath(`/${locale}/payroll`);
  return { ok: true };
}
