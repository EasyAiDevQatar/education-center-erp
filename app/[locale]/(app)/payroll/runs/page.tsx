import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, FINANCE_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { displayName } from "@/lib/names";
import { PageHeader } from "@/components/page-header";
import { RunsClient, type RunRow } from "./runs-client";

export default async function PayrollRunsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, FINANCE_ROLES);

  const t = await getTranslations("runs");

  const [runs, employees] = await Promise.all([
    db.payrollRun.findMany({
      orderBy: { createdAt: "desc" },
      include: { items: { select: { netPaid: true } } },
    }),
    db.employee.findMany({
      where: { status: { not: "TERMINATED" } },
      orderBy: { name: "asc" },
      include: { teacher: { select: { id: true } } },
    }),
  ]);

  const rows: RunRow[] = runs.map((r) => ({
    id: r.id,
    month: r.month,
    status: r.status,
    paymentMethod: r.paymentMethod,
    itemCount: r.items.length,
    total: r.items.reduce((n, i) => n + toNumber(i.netPaid), 0),
    createdAt: r.createdAt.toISOString().slice(0, 10),
    paidAt: r.paidAt?.toISOString().slice(0, 10) ?? null,
  }));

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <RunsClient
        runs={rows}
        employees={employees.map((e) => ({
          id: e.id,
          label: displayName(e, locale),
          isTeacher: !!e.teacher,
        }))}
      />
    </div>
  );
}
