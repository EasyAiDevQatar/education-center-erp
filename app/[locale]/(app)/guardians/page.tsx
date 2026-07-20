import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { GuardiansClient, type GuardianRow } from "./guardians-client";

export default async function GuardiansPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);

  const t = await getTranslations("guardians");
  const guardians = await db.guardian.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { students: true } } },
  });
  const rows: GuardianRow[] = guardians.map((g) => ({
    id: g.id,
    name: g.name,
    phone: g.phone,
    email: g.email,
    notes: g.notes,
    studentCount: g._count.students,
  }));

  return (
    <div>
      <PageHeader title={t("title")} />
      <GuardiansClient guardians={rows} />
    </div>
  );
}
