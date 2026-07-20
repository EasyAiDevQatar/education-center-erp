import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, FINANCE_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import {
  getAttendance,
  getRevenueBreakdown,
  getPackageReport,
  getPayoutSummary,
  getTopDebtors,
} from "@/lib/report-queries";
import { PageHeader } from "@/components/page-header";
import { ReportsClient, type ReportTab } from "./reports-client";

const TABS: ReportTab[] = ["attendance", "revenue", "packages", "payroll", "debtors"];

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, FINANCE_ROLES);

  const t = await getTranslations("reports");
  const sp = await searchParams;
  const get = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };

  const tab = (TABS.includes(get("tab") as ReportTab) ? get("tab") : "attendance") as ReportTab;
  const groupBy = get("by");
  const termId = get("term");

  // An explicit term wins over loose dates, so the two controls can't disagree.
  const terms = await db.term.findMany({ orderBy: { startDate: "desc" } });
  const term = termId ? terms.find((x) => x.id === termId) : undefined;

  const fromStr = term ? term.startDate.toISOString().slice(0, 10) : get("from");
  const toStr = term ? term.endDate.toISOString().slice(0, 10) : get("to");
  const range = {
    from: fromStr ? new Date(`${fromStr}T00:00:00.000Z`) : undefined,
    to: toStr ? new Date(`${toStr}T23:59:59.999Z`) : undefined,
  };

  const settings = await db.setting.findMany({ where: { key: { in: ["currency", "centerName"] } } });
  const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  // Only the visible report is queried — the others cost nothing until opened.
  const data = await (async () => {
    switch (tab) {
      case "attendance":
        return { attendance: await getAttendance(groupBy === "student" ? "student" : "teacher", range) };
      case "revenue":
        return {
          revenue: await getRevenueBreakdown(
            groupBy === "level" || groupBy === "location" ? groupBy : "teacher",
            range,
            locale,
          ),
        };
      case "packages":
        return { packages: await getPackageReport(range) };
      case "payroll":
        return { payouts: await getPayoutSummary(range) };
      case "debtors":
        return { debtors: await getTopDebtors(200) };
    }
  })();

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ReportsClient
        tab={tab}
        groupBy={groupBy}
        filter={{ from: get("from"), to: get("to"), term: termId }}
        terms={terms.map((x) => ({
          id: x.id,
          label: locale === "ar" ? x.nameAr : x.nameEn,
        }))}
        currency={settingsMap.currency ?? "QAR"}
        centerName={settingsMap.centerName ?? ""}
        periodLabel={fromStr || toStr ? `${fromStr || "…"} — ${toStr || "…"}` : t("allTime")}
        {...data}
      />
    </div>
  );
}
