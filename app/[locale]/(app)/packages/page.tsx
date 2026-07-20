import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { PackagesClient, type PackageRow, type Opt } from "./packages-client";

export default async function PackagesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);

  const t = await getTranslations("packages");
  const [packages, students, settingsRow] = await Promise.all([
    db.package.findMany({ orderBy: { purchasedAt: "desc" }, include: { student: true } }),
    db.student.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.setting.findUnique({ where: { key: "currency" } }),
  ]);

  const currency = settingsRow?.value ?? "QAR";
  const rows: PackageRow[] = packages.map((p) => ({
    id: p.id,
    studentId: p.studentId,
    studentName: p.student.name,
    totalHours: toNumber(p.totalHours),
    hoursUsed: toNumber(p.hoursUsed),
    price: toNumber(p.price),
    purchasedAt: p.purchasedAt.toISOString().slice(0, 10),
    expiresAt: p.expiresAt ? p.expiresAt.toISOString().slice(0, 10) : null,
    status: p.status,
    notes: p.notes,
  }));
  const studentOpts: Opt[] = students.map((s) => ({ id: s.id, label: s.name }));

  return (
    <div>
      <PageHeader title={t("title")} />
      <PackagesClient packages={rows} students={studentOpts} currency={currency} />
    </div>
  );
}
