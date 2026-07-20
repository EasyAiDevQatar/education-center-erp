import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { LeadsBoard, type LeadRow } from "./leads-board";

export default async function LeadsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);

  const t = await getTranslations("leads");

  const [leads, levels, teachers] = await Promise.all([
    db.lead.findMany({
      orderBy: [{ followUpAt: "asc" }, { createdAt: "desc" }],
      include: { gradeLevel: true, _count: { select: { sessions: true } } },
    }),
    db.gradeLevel.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.teacher.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  const label = (ar: string, en: string) => (locale === "ar" ? ar : en);

  const rows: LeadRow[] = leads.map((l) => ({
    id: l.id,
    name: l.name,
    phone: l.phone,
    email: l.email,
    source: l.source,
    status: l.status,
    notes: l.notes,
    gradeLevelId: l.gradeLevelId,
    gradeLabel: l.gradeLevel ? label(l.gradeLevel.nameAr, l.gradeLevel.nameEn) : null,
    followUpAt: l.followUpAt ? l.followUpAt.toISOString().slice(0, 10) : null,
    studentId: l.studentId,
    trialCount: l._count.sessions,
  }));

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <LeadsBoard
        leads={rows}
        levels={levels.map((l) => ({ id: l.id, label: label(l.nameAr, l.nameEn) }))}
        teachers={teachers.map((x) => ({ id: x.id, label: x.name }))}
        today={new Date().toISOString().slice(0, 10)}
      />
    </div>
  );
}
