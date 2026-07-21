import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { StudentsClient, type StudentRow, type Option } from "./students-client";
import { displayName } from "@/lib/names";

export default async function StudentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);

  const t = await getTranslations("students");

  // Assignments are per academic year; before any year exists they are unscoped.
  const currentYear = await db.academicYear.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });

  const [students, levels, guardians, teachers] = await Promise.all([
    db.student.findMany({
      orderBy: { name: "asc" },
      include: {
        gradeLevel: true,
        guardian: true,
        teachers: { where: { academicYearId: currentYear?.id ?? null } },
      },
    }),
    db.gradeLevel.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.guardian.findMany({ orderBy: { name: "asc" } }),
    db.teacher.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  const teacherOptions: Option[] = teachers.map((x) => ({ id: x.id, label: displayName(x, locale) }));

  const levelOptions: Option[] = levels.map((l) => ({
    id: l.id,
    label: locale === "ar" ? l.nameAr : l.nameEn,
  }));
  const guardianOptions: Option[] = guardians.map((g) => ({ id: g.id, label: displayName(g, locale) }));

  const rows: StudentRow[] = students.map((s) => ({
    id: s.id,
    name: s.name,
    nameEn: s.nameEn,
    phone: s.phone,
    gradeLevelId: s.gradeLevelId,
    gradeLevelLabel: s.gradeLevel
      ? locale === "ar"
        ? s.gradeLevel.nameAr
        : s.gradeLevel.nameEn
      : null,
    guardianId: s.guardianId,
    guardianLabel: s.guardian ? displayName(s.guardian, locale) : null,
    active: s.active,
    notes: s.notes,
    address: s.address,
    homeLat: s.homeLat,
    homeLng: s.homeLng,
    checkinPin: s.checkinPin,
    homeCode: s.homeCode,
    teacherIds: s.teachers.map((x) => x.teacherId),
  }));

  return (
    <div>
      <PageHeader title={t("title")} />
      <StudentsClient
        students={rows}
        levels={levelOptions}
        guardians={guardianOptions}
        teachers={teacherOptions}
      />
    </div>
  );
}
