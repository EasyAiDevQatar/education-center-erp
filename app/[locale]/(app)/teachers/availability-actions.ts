"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { normalizeWindows } from "@/lib/conflicts";

export type AvailabilityState = { ok?: boolean; error?: string; count?: number };

const schema = z.object({
  teacherId: z.string().min(1),
  windows: z
    .array(
      z.object({
        weekday: z.coerce.number().int().min(0).max(6),
        startMin: z.coerce.number().int().min(0).max(24 * 60),
        endMin: z.coerce.number().int().min(0).max(24 * 60),
      }),
    )
    .max(70),
});

/**
 * Replace a teacher's whole weekly availability in one transaction.
 *
 * Sending an empty list clears it, which puts the teacher back to "always
 * available" — that is the documented way to switch the warning off again.
 */
export async function saveAvailability(
  locale: string,
  input: z.infer<typeof schema>,
): Promise<AvailabilityState> {
  const s = await getSession();
  if (!s || !STAFF_ROLES.includes(s.role)) return { error: "forbidden" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const { teacherId, windows } = parsed.data;

  // Normalise per weekday so overlapping/backwards rows can't be stored.
  const rows: { weekday: number; startMin: number; endMin: number }[] = [];
  for (let wd = 0; wd <= 6; wd++) {
    for (const w of normalizeWindows(windows.filter((x) => x.weekday === wd))) {
      rows.push({ weekday: wd, startMin: w.startMin, endMin: w.endMin });
    }
  }

  await db.$transaction([
    db.teacherAvailability.deleteMany({ where: { teacherId } }),
    ...(rows.length
      ? [db.teacherAvailability.createMany({ data: rows.map((r) => ({ ...r, teacherId })) })]
      : []),
  ]);

  await writeAudit("TeacherAvailability", teacherId, "UPDATE", {
    after: { windows: rows.length },
  });
  revalidatePath(`/${locale}/teachers/${teacherId}`);
  revalidatePath(`/${locale}/planner`);
  revalidatePath(`/${locale}/calendar`);
  return { ok: true, count: rows.length };
}
