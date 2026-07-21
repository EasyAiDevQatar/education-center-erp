"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { TEACHER_PAYMENT_MODES } from "@/lib/enums";
import { EARNINGS_MODES } from "@/lib/earnings-mode";

export type ActionState = { ok?: boolean; error?: string };

const schema = z.object({
  name: z.string().trim().min(1),
  nameEn: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  commissionPct: z.coerce.number().min(0).max(100).default(0),
  fixedSalary: z.coerce.number().min(0).default(0),
  fixedDeductions: z.coerce.number().min(0).default(0),
  /** Empty string = inherit the centre default. */
  earningsMode: z.enum(EARNINGS_MODES).optional().nullable(),
  paymentMode: z.enum(TEACHER_PAYMENT_MODES).optional().nullable(),
  active: z.coerce.boolean().default(true),
  notes: z.string().trim().optional().nullable(),
});

/** Empty strings from the form become null, so an unset name is absent rather
    than an empty string that would defeat the display fallback. */
function orNull(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

async function guard(): Promise<string | null> {
  const s = await getSession();
  if (!s || !STAFF_ROLES.includes(s.role)) return "forbidden";
  return null;
}

function revalidate(locale: string) {
  revalidatePath(`/${locale}/teachers`);
}

export async function saveTeacher(
  locale: string,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };

  const parsed = schema.safeParse({
    name: formData.get("name"),
    nameEn: orNull(formData.get("nameEn")),
    phone: formData.get("phone") || null,
    commissionPct: formData.get("commissionPct") || 0,
    fixedSalary: formData.get("fixedSalary") || 0,
    fixedDeductions: formData.get("fixedDeductions") || 0,
    earningsMode: orNull(formData.get("earningsMode")),
    paymentMode: formData.get("paymentMode") || null,
    active: formData.get("active") === "on" || formData.get("active") === "true",
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) return { error: "invalid" };

  const data = parsed.data;
  if (id) {
    await db.teacher.update({ where: { id }, data });
    await writeAudit("Teacher", id, "UPDATE", { after: data });
  } else {
    const created = await db.teacher.create({ data });
    await writeAudit("Teacher", created.id, "CREATE", { after: data });
  }
  revalidate(locale);
  return { ok: true };
}

export async function deleteTeacher(
  locale: string,
  id: string,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  // Soft delete: teachers are referenced by sessions/payments.
  await db.teacher.update({ where: { id }, data: { active: false } });
  await writeAudit("Teacher", id, "DELETE");
  revalidate(locale);
  return { ok: true };
}
