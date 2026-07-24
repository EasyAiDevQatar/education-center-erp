"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { LOCATIONS } from "@/lib/enums";

export type ActionState = { ok?: boolean; error?: string };

async function guard() {
  const s = await getSession();
  return !s || !STAFF_ROLES.includes(s.role);
}

const orNull = (v: FormDataEntryValue | null) => {
  const t = (v ?? "").toString().trim();
  return t === "" ? null : t;
};
const numOrNull = (v: FormDataEntryValue | null) => {
  const t = orNull(v);
  if (t === null) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  teacherId: z.string().min(1).nullable(),
  subjectId: z.string().min(1).nullable(),
  gradeLevelId: z.string().min(1).nullable(),
  location: z.enum(LOCATIONS),
  active: z.coerce.boolean().default(true),
  notes: z.string().trim().max(500).nullable(),
});

export async function saveGroup(
  locale: string,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = schema.safeParse({
    name: formData.get("name"),
    teacherId: orNull(formData.get("teacherId")),
    subjectId: orNull(formData.get("subjectId")),
    gradeLevelId: orNull(formData.get("gradeLevelId")),
    location: formData.get("location") || "CENTER",
    active: formData.get("active") === "on" || formData.get("active") === "true",
    notes: orNull(formData.get("notes")),
  });
  if (!parsed.success) return { error: "invalid" };
  const data = { ...parsed.data, defaultPricePerHour: numOrNull(formData.get("defaultPricePerHour")) };

  if (id) {
    await db.studentGroup.update({ where: { id }, data });
    await writeAudit("StudentGroup", id, "UPDATE", { after: data });
  } else {
    const created = await db.studentGroup.create({ data });
    await writeAudit("StudentGroup", created.id, "CREATE", { after: data });
  }
  revalidatePath(`/${locale}/groups`);
  return { ok: true };
}

export async function deleteGroup(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  await db.studentGroup.delete({ where: { id } });
  await writeAudit("StudentGroup", id, "DELETE");
  revalidatePath(`/${locale}/groups`);
  return { ok: true };
}

const membersSchema = z.object({
  groupId: z.string().min(1),
  members: z
    .array(
      z.object({
        studentId: z.string().min(1),
        pricePerHour: z.number().min(0).max(100000).nullable(),
      }),
    )
    .max(200),
});

/**
 * Replace a group's roster in one shot.
 *
 * Wholesale replacement keeps the saved list exactly what the editor shows —
 * layering adds/removes would drift from the on-screen state. Prices are
 * per-student; a null price means "inherit the group default, then the matrix".
 */
export async function setGroupMembers(
  locale: string,
  input: z.infer<typeof membersSchema>,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = membersSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const { groupId, members } = parsed.data;

  const seen = new Map<string, number | null>();
  for (const m of members) seen.set(m.studentId, m.pricePerHour);

  await db.$transaction([
    db.groupMember.deleteMany({ where: { groupId } }),
    ...[...seen.entries()].map(([studentId, pricePerHour]) =>
      db.groupMember.create({ data: { groupId, studentId, pricePerHour } }),
    ),
  ]);
  await writeAudit("StudentGroup", groupId, "UPDATE", { after: { members: seen.size } });
  revalidatePath(`/${locale}/groups`);
  return { ok: true };
}