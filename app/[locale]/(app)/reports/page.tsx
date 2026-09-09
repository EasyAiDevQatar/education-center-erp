import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, FINANCE_ROLES } from "@/lib/rbac";
import { requireModule } from "@/lib/modules";
import { db } from "@/lib/db";
import {
  getAttendance,
  getRevenueBreakdown,
  getCollectionsByMethod,
  getPackageReport,
  getPayoutSummary,
  getTopDebtors,
  getDailySessionReport,
} from "@/lib/report-queries";
import { resolveReportDateStrings } from "@/lib/report-range";
import { formatDateOnly } from "@/lib/date-only";
import { PageHeader } from "@/components/page-header";
import { ReportsClient, type ReportTab } from "./reports-client";

const TABS: ReportTab[] = ["daily-sessions", "attendance", "revenue", "collections", "packages", "payroll", "debtors"];

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
  await requireModule(locale, "reports");

  const t = await getTranslations("reports");
  const sp = await searchParams;
  const get = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };

  const tab = (TABS.includes(get("tab") as ReportTab) ? get("tab") : "daily-sessions") as ReportTab;
  const groupBy = get("by");
  const termId = get("term");

  // An explicit term wins over loose dates, so the two controls can't disagree.
  const terms = await db.term.findMany({ orderBy: { startDate: "desc" } });
  const term = termId ? terms.find((x) => x.id === termId) : undefined;

  const { from: fromStr, to: toStr } = resolveReportDateStrings({
    report: tab,
    from: get("from"),
    to: get("to"),
    termFrom: term?.startDate.toISOString().slice(0, 10),
    termTo: term?.endDate.toISOString().slice(0, 10),
  });
  const range = {
    from: fromStr ? new Date(`${fromStr}T00:00:00.000Z`) : undefined,
    to: toStr ? new Date(`${toStr}T23:59:59.999Z`) : undefined,
  };

  const settings = await db.setting.findMany({ where: { key: { in: ["currency", "centerName", "receiptSize"] } } });
  const settingsMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  // Only the visible report is queried — the others cost nothing until opened.
  const data = await (async () => {
    switch (tab) {
      case "daily-sessions":
        return { dailySessions: await getDailySessionReport(range) };
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
      case "collections":
        return { collections: await getCollectionsByMethod(range) };
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
        filter={{ from: fromStr, to: toStr, term: term?.id ?? "" }}
        terms={terms.map((x) => ({
          id: x.id,
          label: locale === "ar" ? x.nameAr : x.nameEn,
        }))}
        currency={settingsMap.currency ?? "QAR"}
        centerName={settingsMap.centerName ?? ""}
        defaultPrintFormat={settingsMap.receiptSize ?? "A4"}
        periodLabel={fromStr || toStr ? `${fromStr ? formatDateOnly(fromStr) : "…"} — ${toStr ? formatDateOnly(toStr) : "…"}` : t("allTime")}
        {...data}
      />
    </div>
  );
}
