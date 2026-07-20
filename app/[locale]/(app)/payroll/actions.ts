"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { FINANCE_ROLES } from "@/lib/rbac";
import { getTeacherEarnings } from "@/lib/payroll";
import { writeAudit } from "@/lib/audit";

export type ActionState = { ok?: boolean; error?: string };

async function guard() {
  const s = await getSession();
  return !s || !FINANCE_ROLES.includes(s.role);
}

const schema = z.object({
  teacherId: z.string().min(1),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  advances: z.coerce.number().min(0).default(0),
  notes: z.string().trim().optional().nullable(),
});

export async function createPayout(
  locale: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = schema.safeParse({
    teacherId: formData.get("teacherId"),
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
    advances: formData.get("advances") || 0,
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) return { error: "invalid" };

  const d = parsed.data;
  const start = new Date(d.periodStart);
  const end = new Date(d.periodEnd);
  end.setHours(23, 59, 59, 999);

  const earnings = await getTeacherEarnings(d.teacherId, start, end);
  const gross = earnings?.commission ?? 0;
  const netPaid = gross - d.advances;

  const created = await db.teacherPayout.create({
    data: {
      teacherId: d.teacherId,
      periodStart: start,
      periodEnd: end,
      grossCommission: gross,
      advances: d.advances,
      netPaid,
      status: "DRAFT",
      notes: d.notes,
    },
  });
  await writeAudit("TeacherPayout", created.id, "CREATE", { after: { gross, netPaid } });
  revalidatePath(`/${locale}/payroll`);
  return { ok: true };
}

export async function markPayoutPaid(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  await db.teacherPayout.update({ where: { id }, data: { status: "PAID" } });
  await writeAudit("TeacherPayout", id, "UPDATE", { after: { status: "PAID" } });
  revalidatePath(`/${locale}/payroll`);
  return { ok: true };
}

export async function deletePayout(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  await db.teacherPayout.delete({ where: { id } });
  await writeAudit("TeacherPayout", id, "DELETE");
  revalidatePath(`/${locale}/payroll`);
  return { ok: true };
}
