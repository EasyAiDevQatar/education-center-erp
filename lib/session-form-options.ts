import "server-only";

import { db } from "@/lib/db";
import { displayName } from "@/lib/names";
import { toNumber } from "@/lib/money";
import { currentPriceMatrix } from "@/lib/pricing";

export type SessionFormStudentOption = {
  id: string;
  name: string;
  teacherIds: string[];
  gradeLevelId: string | null;
  gradeYear: number | null;
  studyLocation: "CENTER" | "HOME";
  specialPricePerHour: number | null;
  specialPriceTeacherIds: string[];
};

export type SessionFormOption = { id: string; label: string };
export type SessionFormPackageOption = { id: string; studentId: string; label: string };
export type SessionFormPriceMatrix = Record<
  string,
  { CENTER: number | null; HOME: number | null }
>;

export type SessionFormOptions = {
  students: SessionFormStudentOption[];
  teachers: SessionFormOption[];
  levels: SessionFormOption[];
  matrix: SessionFormPriceMatrix;
  currency: string;
  packages: SessionFormPackageOption[];
  subjects: SessionFormOption[];
  teacherSubjectIds: Record<string, string[]>;
};

/**
 * Load every option used by the standard individual-session dialog.
 *
 * Profile pages use the same loader as Daily Sessions so pricing, packages,
 * teacher assignments and subject filtering cannot drift between booking
 * entry points. `studentIds` intentionally narrows both students and packages;
 * the student profile therefore cannot accidentally book for a sibling.
 */
export async function loadSessionFormOptions(
  locale: string,
  { studentIds }: { studentIds?: string[] } = {},
): Promise<SessionFormOptions> {
  const ids = studentIds ? [...new Set(studentIds)] : undefined;
  const currentYear = await db.academicYear.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });

  const [students, teachers, levels, matrix, currencyRow, activePackages, subjects, subjectLinks] =
    await Promise.all([
      db.student.findMany({
        where: {
          active: true,
          ...(ids ? { id: { in: ids } } : {}),
        },
        orderBy: { name: "asc" },
        include: {
          teachers: { where: { academicYearId: currentYear?.id ?? null } },
          specialPriceTeachers: { select: { teacherId: true } },
        },
      }),
      db.teacher.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      db.gradeLevel.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
      currentPriceMatrix(),
      db.setting.findUnique({ where: { key: "currency" }, select: { value: true } }),
      db.package.findMany({
        where: {
          status: "ACTIVE",
          ...(ids ? { studentId: { in: ids } } : {}),
        },
        orderBy: { purchasedAt: "desc" },
      }),
      db.subject.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { nameAr: "asc" }],
      }),
      db.teacherSubject.findMany({ select: { teacherId: true, subjectId: true } }),
    ]);

  const label = (ar: string, en: string) => (locale === "ar" ? ar : en);
  const teacherSubjectIds: Record<string, string[]> = {};
  for (const row of subjectLinks) {
    (teacherSubjectIds[row.teacherId] ??= []).push(row.subjectId);
  }

  return {
    students: students.map((student) => ({
      id: student.id,
      name: displayName(student, locale),
      teacherIds: student.teachers.map((row) => row.teacherId),
      gradeLevelId: student.gradeLevelId,
      gradeYear: student.gradeYear,
      studyLocation: student.studyLocation as "CENTER" | "HOME",
      specialPricePerHour:
        student.specialPricePerHour == null ? null : toNumber(student.specialPricePerHour),
      specialPriceTeacherIds: student.specialPriceTeachers.map((row) => row.teacherId),
    })),
    teachers: teachers.map((teacher) => ({
      id: teacher.id,
      label: displayName(teacher, locale),
    })),
    levels: levels.map((level) => ({
      id: level.id,
      label: label(level.nameAr, level.nameEn),
    })),
    matrix: Object.fromEntries(
      matrix.map((row) => [
        row.gradeLevel.id,
        { CENTER: row.CENTER, HOME: row.HOME },
      ]),
    ),
    currency: currencyRow?.value ?? "QAR",
    packages: activePackages.map((item) => ({
      id: item.id,
      studentId: item.studentId,
      label: `${toNumber(item.totalHours) - toNumber(item.hoursUsed)} / ${toNumber(item.totalHours)} ${
        locale === "ar" ? "ساعة متبقية" : "h remaining"
      }`,
    })),
    subjects: subjects.map((subject) => ({
      id: subject.id,
      label: label(subject.nameAr, subject.nameEn),
    })),
    teacherSubjectIds,
  };
}
