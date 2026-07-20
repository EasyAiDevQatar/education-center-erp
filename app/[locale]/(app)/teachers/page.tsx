import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { TeachersClient, type TeacherRow } from "./teachers-client";

export default async function TeachersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);

  const t = await getTranslations("teachers");
  const teachers = await db.teacher.findMany({ orderBy: { name: "asc" } });
  const rows: TeacherRow[] = teachers.map((teacher) => ({
    id: teacher.id,
    name: teacher.name,
    phone: teacher.phone,
    commissionPct: toNumber(teacher.commissionPct),
    active: teacher.active,
    notes: teacher.notes,
  }));

  return (
    <div>
      <PageHeader title={t("title")} />
      <TeachersClient teachers={rows} />
    </div>
  );
}
