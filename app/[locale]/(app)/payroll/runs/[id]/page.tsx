import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, FINANCE_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { displayName, fullName } from "@/lib/names";
import { PageHeader } from "@/components/page-header";
import { RunDetailClient, type ItemRow } from "./run-detail-client";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireRole(locale, FINANCE_ROLES);

  const t = await getTranslations("runs");

  const [run, settingsRows] = await Promise.all([
    db.payrollRun.findUnique({
      where: { id },
      include: {
        items: {
          include: { teacher: true, employee: true },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    db.setting.findMany({ where: { key: { in: ["centerName", "centerLogo", "currency"] } } }),
  ]);
  if (!run) notFound();

  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));

  const items: ItemRow[] = run.items.map((p) => {
    const subject = p.employee ?? p.teacher;
    return {
      id: p.id,
      name: subject ? displayName(subject, locale) : "—",
      fullName: subject ? fullName(subject, locale) : "—",
      employeeNo: p.employee?.employeeNo ?? null,
      jobTitle: p.employee?.jobTitle ?? null,
      basicSalary: toNumber(p.basicSalary),
      allowances: toNumber(p.allowances),
      commission: toNumber(p.grossCommission),
      deductions: toNumber(p.deductions),
      advances: toNumber(p.advances),
      netPaid: toNumber(p.netPaid),
      workingDays: p.workingDays,
      unpaidLeaveDays: toNumber(p.unpaidLeaveDays),
      status: p.status,
      paymentMethod: p.paymentMethod,
      earnMode: p.earnMode,
    };
  });

  return (
    <div>
      <PageHeader
        title={t("runTitle", { month: run.month })}
        description={t("runSubtitle", { n: items.length })}
      />
      <RunDetailClient
        runId={run.id}
        month={run.month}
        status={run.status}
        items={items}
        centerName={settings.centerName ?? ""}
        centerLogo={settings.centerLogo ?? ""}
        currency={settings.currency ?? "QAR"}
      />
    </div>
  );
}
