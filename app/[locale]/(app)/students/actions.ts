"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { autoFillNameEn } from "@/lib/ai/translate-names";
import { LOCATIONS } from "@/lib/enums";

export type ActionState = { ok?: boolean; error?: string };

const schema = z.object({
  name: z.string().trim().min(1),
  nameEn: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  gradeLevelId: z.string().trim().optional().nullable(),
  gradeYear: z.coerce.number().int().min(1).max(12).optional().nullable(),
  specialPricePerHour: z.coerce.number().min(0).max(1_000_000).optional().nullable(),
  guardianId: z.string().trim().optional().nullable(),
  studyLocation: z.enum(LOCATIONS).default("CENTER"),
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
    nameEn: orNull(formData.get("nameEn")),
    phone: formData.get("phone") || null,
    gradeLevelId: formData.get("gradeLevelId") || null,
    gradeYear: formData.get("gradeYear") || null,
    specialPricePerHour: orNull(formData.get("specialPricePerHour")),
    guardianId: formData.get("guardianId") || null,
    studyLocation: formData.get("studyLocation") || "CENTER",
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
  const specialPriceTeacherIds = formData.getAll("specialPriceTeacherIds").map(String).filter(Boolean);
  if (!(await validTeacherIds([...teacherIds, ...specialPriceTeacherIds]))) return { error: "invalid" };

  let studentId: string;
  if (id) {
    await db.student.update({ where: { id }, data });
    await writeAudit("Student", id, "UPDATE", { after: data });
    studentId = id;
  } else {
    const created = await db.student.create({ data });
    await writeAudit("Student", created.id, "CREATE", { after: data });
    // Fill the Latin spelling when the AI auto-translate toggle is on.
    await autoFillNameEn("students", created.id, data.name, data.nameEn);
    studentId = created.id;
  }

  await setStudentTeachers(studentId, teacherIds);
  await setStudentSpecialPriceTeachers(studentId, specialPriceTeacherIds);

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

/** Focused profile edit for the two values reception changes most often. */
export async function saveStudentPricingAndTeachers(
  locale: string,
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = z.coerce.number().min(0).max(1_000_000).nullable().safeParse(
    orNull(formData.get("specialPricePerHour")),
  );
  if (!parsed.success) return { error: "invalid" };

  const teacherIds = [...new Set(formData.getAll("teacherIds").map(String).filter(Boolean))];
  const specialPriceTeacherIds = [
    ...new Set(formData.getAll("specialPriceTeacherIds").map(String).filter(Boolean)),
  ];
  if (!(await validTeacherIds([...teacherIds, ...specialPriceTeacherIds]))) return { error: "invalid" };

  await db.student.update({ where: { id }, data: { specialPricePerHour: parsed.data } });
  await setStudentTeachers(id, teacherIds);
  await setStudentSpecialPriceTeachers(id, specialPriceTeacherIds);
  await writeAudit("Student", id, "UPDATE", {
    after: { specialPricePerHour: parsed.data, teacherIds, specialPriceTeacherIds },
  });
  revalidatePath(`/${locale}/students`);
  revalidatePath(`/${locale}/students/${id}`);
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

async function validTeacherIds(ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return true;
  return (await db.teacher.count({ where: { id: { in: unique }, active: true } })) === unique.length;
}

async function setStudentSpecialPriceTeachers(studentId: string, teacherIds: string[]) {
  const unique = [...new Set(teacherIds)];
  await db.$transaction([
    db.studentSpecialPriceTeacher.deleteMany({ where: { studentId } }),
    ...(unique.length
      ? [
          db.studentSpecialPriceTeacher.createMany({
            data: unique.map((teacherId) => ({ studentId, teacherId })),
          }),
        ]
      : []),
  ]);
}
