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
  phone: z.string().trim().optional().nullable(),
  gradeLevelId: z.string().trim().optional().nullable(),
  guardianId: z.string().trim().optional().nullable(),
  active: z.coerce.boolean().default(true),
  notes: z.string().trim().optional().nullable(),
  // Home-session attendance
  address: z.string().trim().optional().nullable(),
  homeLat: z.coerce.number().min(-90).max(90).optional().nullable(),
  homeLng: z.coerce.number().min(-180).max(180).optional().nullable(),
  checkinPin: z.string().trim().regex(/^\d{4,6}$/).optional().nullable(),
  homeCode: z.string().trim().max(40).optional().nullable(),
});

/** Empty strings from the form become null for optional numeric/text fields. */
function orNull(v: FormDataEntryValue | null): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}

async function guard() {
  const s = await getSession();
  return !s || !STAFF_ROLES.includes(s.role);
}

export async function saveStudent(
  locale: string,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = schema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone") || null,
    gradeLevelId: formData.get("gradeLevelId") || null,
    guardianId: formData.get("guardianId") || null,
    active: formData.get("active") === "on" || formData.get("active") === "true",
    notes: formData.get("notes") || null,
    address: orNull(formData.get("address")),
    homeLat: orNull(formData.get("homeLat")),
    homeLng: orNull(formData.get("homeLng")),
    checkinPin: orNull(formData.get("checkinPin")),
    homeCode: orNull(formData.get("homeCode")),
  });
  if (!parsed.success) return { error: "invalid" };

  const data = parsed.data;
  // Multi-select posts one hidden input per teacher.
  const teacherIds = formData.getAll("teacherIds").map(String).filter(Boolean);

  let studentId: string;
  if (id) {
    await db.student.update({ where: { id }, data });
    await writeAudit("Student", id, "UPDATE", { after: data });
    studentId = id;
  } else {
    const created = await db.student.create({ data });
    await writeAudit("Student", created.id, "CREATE", { after: data });
    studentId = created.id;
  }

  await setStudentTeachers(studentId, teacherIds);

  revalidatePath(`/${locale}/students`);
  revalidatePath(`/${locale}/students/${studentId}`);
  return { ok: true };
}

export async function deleteStudent(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  // Soft delete: students are referenced by sessions/payments.
  await db.student.update({ where: { id }, data: { active: false } });
  await writeAudit("Student", id, "DELETE");
  revalidatePath(`/${locale}/students`);
  return { ok: true };
}

/**
 * Replace a student's teacher assignments for the current academic year.
 *
 * Replace-all rather than diffing: the control is a multi-select, so the
 * submitted list *is* the desired state, and rewriting it wholesale means
 * duplicates are impossible even where the unique index can't help (a null
 * academicYearId makes rows distinct in Postgres).
 */
async function setStudentTeachers(studentId: string, teacherIds: string[]) {
  // Assignments belong to whichever year is current; before any year exists
  // they are simply unscoped, so the feature works from day one.
  const currentYear = await db.academicYear.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });
  const academicYearId = currentYear?.id ?? null;

  await db.$transaction([
    db.studentTeacher.deleteMany({ where: { studentId, academicYearId } }),
    ...(teacherIds.length
      ? [
          db.studentTeacher.createMany({
            data: teacherIds.map((teacherId) => ({ studentId, teacherId, academicYearId })),
          }),
        ]
      : []),
  ]);
}
