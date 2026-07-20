"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { PACKAGE_STATUSES } from "@/lib/enums";

export type ActionState = { ok?: boolean; error?: string };

const schema = z.object({
  studentId: z.string().min(1),
  totalHours: z.coerce.number().positive(),
  hoursUsed: z.coerce.number().min(0).default(0),
  price: z.coerce.number().min(0),
  purchasedAt: z.string().min(1),
  expiresAt: z.string().optional().nullable(),
  status: z.enum(PACKAGE_STATUSES).default("ACTIVE"),
  notes: z.string().trim().optional().nullable(),
});

async function guard() {
  const s = await getSession();
  return !s || !STAFF_ROLES.includes(s.role);
}

export async function savePackage(
  locale: string,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };

  const parsed = schema.safeParse({
    studentId: formData.get("studentId"),
    totalHours: formData.get("totalHours"),
    hoursUsed: formData.get("hoursUsed") || 0,
    price: formData.get("price") || 0,
    purchasedAt: formData.get("purchasedAt"),
    expiresAt: formData.get("expiresAt") || null,
    status: formData.get("status") || "ACTIVE",
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) return { error: "invalid" };

  const d = parsed.data;
  const data = {
    studentId: d.studentId,
    totalHours: d.totalHours,
    hoursUsed: d.hoursUsed,
    price: d.price,
    purchasedAt: new Date(d.purchasedAt),
    expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
    status: d.status,
    notes: d.notes,
  };

  if (id) {
    await db.package.update({ where: { id }, data });
    await writeAudit("Package", id, "UPDATE", { after: data });
  } else {
    const created = await db.package.create({ data });
    await writeAudit("Package", created.id, "CREATE", { after: data });
  }
  revalidatePath(`/${locale}/packages`);
  return { ok: true };
}

export async function deletePackage(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  await db.package.delete({ where: { id } });
  await writeAudit("Package", id, "DELETE");
  revalidatePath(`/${locale}/packages`);
  return { ok: true };
}
