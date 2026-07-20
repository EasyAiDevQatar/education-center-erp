"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { FINANCE_ROLES } from "@/lib/rbac";
import { getTeacherEarnings } from "@/lib/payroll";
import { writeAudit } from "@/lib/audit";
import { notifyPayout } from "@/lib/integrations/notify";
import { effectiveMode, monthRange } from "@/lib/payroll-period";

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
  /** MONTH mode submits a YYYY-MM; TERM mode submits a term id. */
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().nullable(),
  termId: z.string().trim().optional().nullable(),
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
    month: formData.get("month") || null,
    termId: formData.get("termId") || null,
  });
  if (!parsed.success) return { error: "invalid" };

  const d = parsed.data;

  // The teacher's payment mode decides how the period is derived, so a MONTH or
  // TERM teacher can never be paid for an arbitrary hand-typed range.
  const [teacher, defaultModeRow] = await Promise.all([
    db.teacher.findUnique({ where: { id: d.teacherId } }),
    db.setting.findUnique({ where: { key: "defaultTeacherPaymentMode" } }),
  ]);
  if (!teacher) return { error: "notfound" };
  const mode = effectiveMode(teacher.paymentMode, defaultModeRow?.value);

  let fromStr = d.periodStart;
  let toStr = d.periodEnd;
  let termId: string | null = null;

  if (mode === "MONTH") {
    if (!d.month) return { error: "monthRequired" };
    ({ from: fromStr, to: toStr } = monthRange(d.month));
  } else if (mode === "TERM") {
    if (!d.termId) return { error: "termRequired" };
    const term = await db.term.findUnique({ where: { id: d.termId } });
    if (!term) return { error: "termRequired" };
    termId = term.id;
    fromStr = term.startDate.toISOString().slice(0, 10);
    toStr = term.endDate.toISOString().slice(0, 10);
  }

  const start = new Date(`${fromStr}T00:00:00.000Z`);
  const end = new Date(`${toStr}T23:59:59.999Z`);
  if (end < start) return { error: "invalidPeriod" };

  const earnings = await getTeacherEarnings(d.teacherId, start, end);
  // Pay on what was actually collected; keep the expected figure for comparison.
  const dueCommission = earnings?.dueCommission ?? 0;
  const expectedCommission = earnings?.expectedCommission ?? 0;
  const fixedSalary = earnings?.fixedSalary ?? 0;
  const deductions = earnings?.fixedDeductions ?? 0;
  const netPaid = dueCommission + fixedSalary - deductions - d.advances;

  const created = await db.teacherPayout.create({
    data: {
      teacherId: d.teacherId,
      periodStart: start,
      periodEnd: end,
      grossCommission: dueCommission,
      expectedCommission,
      fixedSalary,
      deductions,
      advances: d.advances,
      netPaid,
      status: "DRAFT",
      notes: d.notes,
      payMode: mode,
      termId,
    },
  });
  await writeAudit("TeacherPayout", created.id, "CREATE", {
    after: { dueCommission, expectedCommission, fixedSalary, deductions, netPaid, mode },
  });
  revalidatePath(`/${locale}/payroll`);
  return { ok: true };
}

export async function markPayoutPaid(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  await db.teacherPayout.update({ where: { id }, data: { status: "PAID" } });
  await writeAudit("TeacherPayout", id, "UPDATE", { after: { status: "PAID" } });
  await notifyPayout(id);
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
