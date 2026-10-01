import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, PEOPLE_ROLES, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { TranslateNamesButton } from "@/components/translate-names-button";
import { loadAiConfig, aiReady } from "@/lib/ai/config";
import { GuardiansClient, type GradeOption, type GuardianRow } from "./guardians-client";

export default async function GuardiansPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const viewer = await requireRole(locale, PEOPLE_ROLES);
  const canManage = STAFF_ROLES.includes(viewer.role);

  const t = await getTranslations("guardians");
  const [guardians, gradeLevels] = await Promise.all([
    db.guardian.findMany({
      orderBy: { name: "asc" },
      include: {
        homes: { orderBy: { sortOrder: "asc" } },
        _count: { select: { students: true } },
      },
    }),
    db.gradeLevel.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const rows: GuardianRow[] = guardians.map((g) => ({
    id: g.id,
    name: g.name,
    nameEn: g.nameEn,
    phone: g.phone,
    email: g.email,
    notes: g.notes,
    studentCount: g._count.students,
    homes: g.homes,
  }));
  const grades: GradeOption[] = gradeLevels.map((grade) => ({
    id: grade.id,
    label: locale === "ar" ? grade.nameAr : grade.nameEn,
  }));

  const aiCfg = await loadAiConfig();
  const aiOn = aiReady(aiCfg);

  return (
    <div>
      <PageHeader title={t("title")} />
      {aiOn && (
        <div className="-mt-3 mb-3">
          <TranslateNamesButton entity="guardians" />
        </div>
      )}
      <GuardiansClient guardians={rows} gradeLevels={grades} canManage={canManage} />
    </div>
  );
}
