import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { displayName } from "@/lib/names";
import { PageHeader } from "@/components/page-header";
import { GroupsClient, type GroupRow, type Opt, type StudentOpt } from "./groups-client";

export default async function GroupsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);
  const t = await getTranslations("groups");

  const [groups, teachers, subjects, levels, students, currencyRow] = await Promise.all([
    db.studentGroup.findMany({
      orderBy: { name: "asc" },
      include: {
        teacher: true,
        subject: true,
        gradeLevel: true,
        members: { include: { student: true } },
      },
    }),
    db.teacher.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.subject.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.gradeLevel.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.student.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.setting.findUnique({ where: { key: "currency" } }),
  ]);

  const label = (ar: string, en: string) => (locale === "ar" ? ar : en);

  const rows: GroupRow[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    teacherId: g.teacherId,
    teacherName: g.teacher ? displayName(g.teacher, locale) : null,
    subjectId: g.subjectId,
    subjectName: g.subject ? label(g.subject.nameAr, g.subject.nameEn) : null,
    gradeLevelId: g.gradeLevelId,
    gradeLabel: g.gradeLevel ? label(g.gradeLevel.nameAr, g.gradeLevel.nameEn) : null,
    location: g.location as "CENTER" | "HOME",
    defaultPricePerHour: g.defaultPricePerHour === null ? null : toNumber(g.defaultPricePerHour),
    active: g.active,
    notes: g.notes,
    members: g.members.map((m) => ({
      studentId: m.studentId,
      name: displayName(m.student, locale),
      pricePerHour: m.pricePerHour === null ? null : toNumber(m.pricePerHour),
    })),
  }));

  const teacherOpts: Opt[] = teachers.map((x) => ({ id: x.id, label: displayName(x, locale) }));
  const subjectOpts: Opt[] = subjects.map((x) => ({ id: x.id, label: label(x.nameAr, x.nameEn) }));
  const levelOpts: Opt[] = levels.map((x) => ({ id: x.id, label: label(x.nameAr, x.nameEn) }));
  const studentOpts: StudentOpt[] = students.map((x) => ({
    id: x.id,
    name: displayName(x, locale),
    gradeYear: x.gradeYear,
  }));

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <GroupsClient
        groups={rows}
        teachers={teacherOpts}
        subjects={subjectOpts}
        levels={levelOpts}
        students={studentOpts}
        currency={currencyRow?.value ?? "QAR"}
      />
    </div>
  );
}