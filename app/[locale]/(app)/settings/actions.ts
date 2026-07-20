"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import type { LocationType } from "@/lib/enums";

export type ActionState = { ok?: boolean; error?: string };

async function guardAdmin() {
  const s = await getSession();
  return !s || s.role !== "ADMIN";
}

function revalidate(locale: string) {
  revalidatePath(`/${locale}/settings`);
}

/* ---- Center profile (key/value settings) ---- */
export async function saveCenterSettings(
  locale: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guardAdmin()) return { error: "forbidden" };
  const entries: Record<string, string> = {
    centerName: String(formData.get("centerName") ?? "").trim(),
    currency: String(formData.get("currency") ?? "QAR").trim(),
    receiptFooter: String(formData.get("receiptFooter") ?? "").trim(),
  };
  for (const [key, value] of Object.entries(entries)) {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
  revalidate(locale);
  return { ok: true };
}

/* ---- Price matrix ---- */
async function setPrice(gradeLevelId: string, location: LocationType, price: number | null) {
  const latest = await db.priceRule.findFirst({
    where: { gradeLevelId, location, active: true },
    orderBy: { effectiveFrom: "desc" },
  });
  if (price == null || Number.isNaN(price)) return;
  if (latest) {
    await db.priceRule.update({ where: { id: latest.id }, data: { pricePerHour: price } });
  } else {
    await db.priceRule.create({ data: { gradeLevelId, location, pricePerHour: price } });
  }
}

export async function savePriceMatrix(
  locale: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guardAdmin()) return { error: "forbidden" };
  const levels = await db.gradeLevel.findMany();
  for (const lvl of levels) {
    const center = formData.get(`center_${lvl.id}`);
    const home = formData.get(`home_${lvl.id}`);
    if (center !== null && center !== "") await setPrice(lvl.id, "CENTER", parseFloat(String(center)));
    if (home !== null && home !== "") await setPrice(lvl.id, "HOME", parseFloat(String(home)));
  }
  await writeAudit("PriceMatrix", "all", "UPDATE");
  revalidate(locale);
  return { ok: true };
}

/* ---- Grade levels ---- */
const gradeSchema = z.object({
  code: z.string().trim().min(1),
  nameAr: z.string().trim().min(1),
  nameEn: z.string().trim().min(1),
  sortOrder: z.coerce.number().int().default(0),
  active: z.coerce.boolean().default(true),
});

export async function saveGradeLevel(
  locale: string,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guardAdmin()) return { error: "forbidden" };
  const parsed = gradeSchema.safeParse({
    code: formData.get("code"),
    nameAr: formData.get("nameAr"),
    nameEn: formData.get("nameEn"),
    sortOrder: formData.get("sortOrder") || 0,
    active: formData.get("active") === "on" || formData.get("active") === "true",
  });
  if (!parsed.success) return { error: "invalid" };
  if (id) await db.gradeLevel.update({ where: { id }, data: parsed.data });
  else await db.gradeLevel.create({ data: parsed.data });
  revalidate(locale);
  return { ok: true };
}

/* ---- Expense categories ---- */
const catSchema = z.object({
  nameAr: z.string().trim().min(1),
  nameEn: z.string().trim().min(1),
  sortOrder: z.coerce.number().int().default(0),
  active: z.coerce.boolean().default(true),
});

export async function saveExpenseCategory(
  locale: string,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guardAdmin()) return { error: "forbidden" };
  const parsed = catSchema.safeParse({
    nameAr: formData.get("nameAr"),
    nameEn: formData.get("nameEn"),
    sortOrder: formData.get("sortOrder") || 0,
    active: formData.get("active") === "on" || formData.get("active") === "true",
  });
  if (!parsed.success) return { error: "invalid" };
  if (id) await db.expenseCategory.update({ where: { id }, data: parsed.data });
  else await db.expenseCategory.create({ data: parsed.data });
  revalidate(locale);
  return { ok: true };
}

export async function deleteExpenseCategory(locale: string, id: string): Promise<ActionState> {
  if (await guardAdmin()) return { error: "forbidden" };
  const used = await db.expense.count({ where: { categoryId: id } });
  if (used > 0) {
    await db.expenseCategory.update({ where: { id }, data: { active: false } });
  } else {
    await db.expenseCategory.delete({ where: { id } });
  }
  revalidate(locale);
  return { ok: true };
}
