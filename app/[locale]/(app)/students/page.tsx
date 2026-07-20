import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { StudentsClient, type StudentRow, type Option } from "./students-client";

export default async function StudentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);

  const t = await getTranslations("students");

  const [students, levels, guardians] = await Promise.all([
    db.student.findMany({
      orderBy: { name: "asc" },
      include: { gradeLevel: true, guardian: true },
    }),
    db.gradeLevel.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.guardian.findMany({ orderBy: { name: "asc" } }),
  ]);

  const levelOptions: Option[] = levels.map((l) => ({
    id: l.id,
    label: locale === "ar" ? l.nameAr : l.nameEn,
  }));
  const guardianOptions: Option[] = guardians.map((g) => ({ id: g.id, label: g.name }));

  const rows: StudentRow[] = students.map((s) => ({
    id: s.id,
    name: s.name,
    phone: s.phone,
    gradeLevelId: s.gradeLevelId,
    gradeLevelLabel: s.gradeLevel
      ? locale === "ar"
        ? s.gradeLevel.nameAr
        : s.gradeLevel.nameEn
      : null,
    guardianId: s.guardianId,
    guardianLabel: s.guardian?.name ?? null,
    active: s.active,
    notes: s.notes,
    address: s.address,
    homeLat: s.homeLat,
    homeLng: s.homeLng,
    checkinPin: s.checkinPin,
  }));

  return (
    <div>
      <PageHeader title={t("title")} />
      <StudentsClient students={rows} levels={levelOptions} guardians={guardianOptions} />
    </div>
  );
}
