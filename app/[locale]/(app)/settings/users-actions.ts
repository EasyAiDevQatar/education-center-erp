"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/password";
import { ROLES } from "@/lib/enums";

export type UserActionState = { ok?: boolean; error?: string };

async function guardAdmin() {
  const s = await getSession();
  return !s || s.role !== "ADMIN" ? null : s;
}

const schema = z.object({
  name: z.string().trim().min(1),
  nameEn: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(ROLES),
  locale: z.enum(["ar", "en"]).default("ar"),
  active: z.coerce.boolean().default(true),
  teacherId: z.string().trim().optional().nullable(),
  guardianId: z.string().trim().optional().nullable(),
  /** Required (min 8) on create; blank on edit keeps the stored hash. */
  password: z.string().optional().nullable(),
});

/** Would this update leave the system without any active admin? */
async function leavesNoActiveAdmin(editingId: string, role: string, active: boolean) {
  if (role === "ADMIN" && active) return false;
  const otherAdmins = await db.user.count({
    where: { role: "ADMIN", active: true, id: { not: editingId } },
  });
  return otherAdmins === 0;
}

export async function saveUser(
  locale: string,
  id: string | null,
  _prev: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const session = await guardAdmin();
  if (!session) return { error: "forbidden" };

  const parsed = schema.safeParse({
    name: formData.get("name"),
    nameEn: (formData.get("nameEn")?.toString().trim() || null),
    email: formData.get("email"),
    role: formData.get("role"),
    locale: formData.get("locale") || "ar",
    active: formData.get("active") === "on" || formData.get("active") === "true",
    teacherId: formData.get("teacherId") || null,
    guardianId: formData.get("guardianId") || null,
    password: formData.get("password") || null,
  });
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  if (d.password && d.password.length < 8) return { error: "passwordShort" };
  if (!id && !d.password) return { error: "passwordRequired" };

  // Unique email check (friendlier than the DB error).
  const existingEmail = await db.user.findUnique({ where: { email: d.email } });
  if (existingEmail && existingEmail.id !== id) return { error: "emailTaken" };

  const base = {
    name: d.name,
    email: d.email,
    role: d.role,
    locale: d.locale,
    active: d.active,
    teacherId: d.teacherId || null,
    guardianId: d.guardianId || null,
  };

  if (id) {
    // Never allow removing the last active admin (including self-demotion).
    if (await leavesNoActiveAdmin(id, d.role, d.active)) return { error: "lastAdmin" };
    const data = d.password
      ? { ...base, passwordHash: await hashPassword(d.password) }
      : base;
    await db.user.update({ where: { id }, data });
    await writeAudit("User", id, "UPDATE", {
      after: { ...base, passwordReset: !!d.password },
    });
  } else {
    const created = await db.user.create({
      data: { ...base, passwordHash: await hashPassword(d.password!) },
    });
    await writeAudit("User", created.id, "CREATE", { after: base });
  }

  revalidatePath(`/${locale}/settings`);
  return { ok: true };
}
