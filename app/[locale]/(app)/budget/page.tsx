import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db";
import { FINANCE_ROLES, requireRole } from "@/lib/rbac";
import { centerToday } from "@/lib/session-time";
import { getBudgetPlanReport } from "@/lib/budget-queries";
import { BudgetClient } from "./budget-client";

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function BudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, FINANCE_ROLES);

  const t = await getTranslations("budget");
  const sp = await searchParams;
  const [plans, categories, academicYear, settings] = await Promise.all([
    db.budgetPlan.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }] }),
    db.expenseCategory.findMany({ orderBy: [{ active: "desc" }, { sortOrder: "asc" }] }),
    db.academicYear.findFirst({
      where: { isCurrent: true },
      orderBy: { startDate: "desc" },
    }),
    db.setting.findMany({ where: { key: { in: ["currency", "receiptSize", "centerName"] } } }),
  ]);
  const settingsMap = Object.fromEntries(settings.map((row) => [row.key, row.value]));

  const requestedPlan = first(sp.plan);
  const selectedPlan = plans.find((plan) => plan.id === requestedPlan) ?? plans[0] ?? null;
  const data = selectedPlan ? await getBudgetPlanReport(selectedPlan.id) : null;
  const today = centerToday();
  const availableMonths = data?.report.months.map((row) => row.month) ?? [];
  const requestedMonth = first(sp.month);
  const selectedMonth = availableMonths.includes(requestedMonth)
    ? requestedMonth
    : availableMonths.includes(today.slice(0, 7))
      ? today.slice(0, 7)
      : availableMonths[0] ?? today.slice(0, 7);
  const view = first(sp.view) === "annual" ? "annual" : "monthly";

  const calendarYear = Number(today.slice(0, 4));
  const defaultStart = academicYear?.startDate.toISOString().slice(0, 10) ?? `${calendarYear}-01-01`;
  const defaultEnd = academicYear?.endDate.toISOString().slice(0, 10) ?? `${calendarYear}-12-31`;
  const defaultName = academicYear
    ? locale === "ar"
      ? academicYear.nameAr
      : academicYear.nameEn
    : String(calendarYear);

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <BudgetClient
        plans={plans.map((plan) => ({
          id: plan.id,
          name: plan.name,
          status: plan.status,
          startDate: plan.startDate.toISOString().slice(0, 10),
          endDate: plan.endDate.toISOString().slice(0, 10),
        }))}
        data={data}
        categories={categories.map((category) => ({
          id: category.id,
          nameAr: category.nameAr,
          nameEn: category.nameEn,
          active: category.active,
          sortOrder: category.sortOrder,
        }))}
        view={view}
        selectedMonth={selectedMonth}
        defaultPlan={{ name: defaultName, startDate: defaultStart, endDate: defaultEnd }}
        currency={settingsMap.currency ?? "QAR"}
        centerName={settingsMap.centerName ?? ""}
        defaultPrintFormat={settingsMap.receiptSize ?? "A4"}
      />
    </div>
  );
}
