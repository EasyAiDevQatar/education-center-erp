"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";

export type ActionState = { ok?: boolean; error?: string };

const schema = z.object({
  name: z.string().trim().min(1),
  nameEn: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

/** Empty strings from the form become null, so an unset name is absent rather
    than an empty string that would defeat the display fallback. */
function orNull(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

async function guard() {
  const s = await getSession();
  return !s || !STAFF_ROLES.includes(s.role);
}

export async function saveGuardian(
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
    email: formData.get("email") || null,
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) return { error: "invalid" };

  if (id) {
    await db.guardian.update({ where: { id }, data: parsed.data });
    await writeAudit("Guardian", id, "UPDATE", { after: parsed.data });
  } else {
    const created = await db.guardian.create({ data: parsed.data });
    await writeAudit("Guardian", created.id, "CREATE", { after: parsed.data });
  }
  revalidatePath(`/${locale}/guardians`);
  return { ok: true };
}

export async function deleteGuardian(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const linked = await db.student.count({ where: { guardianId: id } });
  if (linked > 0) return { error: "linked" };
  await db.guardian.delete({ where: { id } });
  await writeAudit("Guardian", id, "DELETE");
  revalidatePath(`/${locale}/guardians`);
  return { ok: true };
}
