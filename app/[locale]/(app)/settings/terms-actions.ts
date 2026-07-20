"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { TEACHER_PAYMENT_MODES } from "@/lib/enums";

export type TermState = { ok?: boolean; error?: string; count?: number };

async function guard() {
  const s = await getSession();
  return !s || s.role !== "ADMIN";
}

const termSchema = z
  .object({
    nameAr: z.string().trim().min(1),
    nameEn: z.string().trim().min(1),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    active: z.coerce.boolean().default(true),
  })
  .refine((d) => d.startDate <= d.endDate, { message: "endBeforeStart" });

/** Create or update an academic term. */
export async function saveTerm(
  locale: string,
  id: string | null,
  _prev: TermState,
  formData: FormData,
): Promise<TermState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = termSchema.safeParse({
    nameAr: formData.get("nameAr"),
    nameEn: formData.get("nameEn"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    active: formData.get("active") === "on" || formData.get("active") === "true",
  });
  if (!parsed.success) {
    const bad = parsed.error.issues.find((i) => i.message === "endBeforeStart");
    return { error: bad ? "endBeforeStart" : "invalid" };
  }
  const d = parsed.data;
  const data = {
    nameAr: d.nameAr,
    nameEn: d.nameEn,
    // Stored as UTC wall-clock, consistent with session dates.
    startDate: new Date(`${d.startDate}T00:00:00.000Z`),
    endDate: new Date(`${d.endDate}T23:59:59.999Z`),
    active: d.active,
  };

  if (id) {
    await db.term.update({ where: { id }, data });
    await writeAudit("Term", id, "UPDATE", { after: data });
  } else {
    const created = await db.term.create({ data });
    await writeAudit("Term", created.id, "CREATE", { after: data });
  }
  revalidatePath(`/${locale}/settings`);
  revalidatePath(`/${locale}/calendar`);
  return { ok: true };
}

export async function deleteTerm(locale: string, id: string): Promise<TermState> {
  if (await guard()) return { error: "forbidden" };
  await db.term.delete({ where: { id } });
  await writeAudit("Term", id, "DELETE");
  revalidatePath(`/${locale}/settings`);
  revalidatePath(`/${locale}/calendar`);
  return { ok: true };
}

/** Set the centre-wide default teacher payment mode. */
export async function saveDefaultPaymentMode(
  locale: string,
  mode: string,
): Promise<TermState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = z.enum(TEACHER_PAYMENT_MODES).safeParse(mode);
  if (!parsed.success) return { error: "invalid" };
  await db.setting.upsert({
    where: { key: "defaultTeacherPaymentMode" },
    create: { key: "defaultTeacherPaymentMode", value: parsed.data },
    update: { value: parsed.data },
  });
  await writeAudit("Setting", "defaultTeacherPaymentMode", "UPDATE", { after: { value: parsed.data } });
  revalidatePath(`/${locale}/settings`);
  return { ok: true };
}

/**
 * Apply one payment mode to every active teacher at once. Passing `inherit`
 * clears the per-teacher override so they all follow the centre default.
 */
export async function applyPaymentModeToAll(
  locale: string,
  mode: string,
): Promise<TermState> {
  if (await guard()) return { error: "forbidden" };
  const value =
    mode === "inherit" ? null : z.enum(TEACHER_PAYMENT_MODES).safeParse(mode).data ?? undefined;
  if (value === undefined) return { error: "invalid" };

  const res = await db.teacher.updateMany({
    where: { active: true },
    data: { paymentMode: value },
  });
  await writeAudit("Teacher", "bulk", "UPDATE", { after: { paymentMode: value, count: res.count } });
  revalidatePath(`/${locale}/settings`);
  revalidatePath(`/${locale}/teachers`);
  return { ok: true, count: res.count };
}
