import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { TeachersClient, type TeacherRow, type SubjectOpt } from "./teachers-client";
import { displayName } from "@/lib/names";

export default async function TeachersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);

  const t = await getTranslations("teachers");
  const [teachers, subjects] = await Promise.all([
    db.teacher.findMany({
      orderBy: { name: "asc" },
      include: { subjects: { include: { subject: true } } },
    }),
    db.subject.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { nameAr: "asc" }],
    }),
  ]);
  const label = (ar: string, en: string) => (locale === "ar" ? ar : en);
  const rows: TeacherRow[] = teachers.map((teacher) => ({
    id: teacher.id,
    name: teacher.name,
    nameEn: teacher.nameEn,
    phone: teacher.phone,
    commissionPct: toNumber(teacher.commissionPct),
    fixedSalary: toNumber(teacher.fixedSalary),
    fixedDeductions: toNumber(teacher.fixedDeductions),
    paymentMode: teacher.paymentMode,
    earningsMode: teacher.earningsMode,
    active: teacher.active,
    notes: teacher.notes,
    subjectIds: teacher.subjects.map((ts) => ts.subjectId),
    subjectLabels: teacher.subjects.map((ts) => label(ts.subject.nameAr, ts.subject.nameEn)),
  }));
  const subjectOpts: SubjectOpt[] = subjects.map((sbj) => ({
    id: sbj.id,
    label: label(sbj.nameAr, sbj.nameEn),
  }));

  return (
    <div>
      <PageHeader title={t("title")} />
      <TeachersClient teachers={rows} subjects={subjectOpts} />
    </div>
  );
}
