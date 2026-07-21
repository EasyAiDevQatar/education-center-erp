import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, FINANCE_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { getAllTeacherEarnings } from "@/lib/payroll";
import { effectiveMode, monthOf } from "@/lib/payroll-period";
import { PageHeader } from "@/components/page-header";
import { PayrollClient, type EarningRow, type PayoutRow } from "./payroll-client";
import { displayName } from "@/lib/names";

export default async function PayrollPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, FINANCE_ROLES);

  const t = await getTranslations("payroll");
  const sp = await searchParams;
  const get = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const filter = { from: get("from"), to: get("to") };
  const fromDate = filter.from ? new Date(filter.from) : undefined;
  const toDate = filter.to ? new Date(filter.to) : undefined;
  if (toDate) toDate.setHours(23, 59, 59, 999);

  const [earningsAll, payouts, settingsRows, earliest, terms] = await Promise.all([
    getAllTeacherEarnings(fromDate, toDate),
    db.teacherPayout.findMany({ orderBy: { createdAt: "desc" }, include: { teacher: true } }),
    db.setting.findMany({ where: { key: { in: ["currency", "defaultTeacherPaymentMode"] } } }),
    db.session.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
    db.term.findMany({ where: { active: true }, orderBy: { startDate: "desc" } }),
  ]);
  const settingsMap = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
  const centreMode = settingsMap.defaultTeacherPaymentMode ?? "MONTH";

  const currency = settingsMap.currency ?? "QAR";
  // Teachers with nothing to show are hidden — but "nothing" now depends on how
  // they earn: someone on a salary is owed it whether or not they taught this
  // period, and filtering on hours alone would drop them off payroll entirely.
  const earningsRaw = earningsAll.filter(
    (e) =>
      e.hours > 0 ||
      e.collected > 0 ||
      (e.earningsMode !== "COMMISSION" && e.fixedSalary > 0),
  );

  const today = new Date().toISOString().slice(0, 10);
  const period = {
    from: filter.from || (earliest ? earliest.date.toISOString().slice(0, 10) : today),
    to: filter.to || today,
  };

  // Each teacher's effective mode drives which period control the dialog shows.
  const earningsWithMode: EarningRow[] = earningsRaw.map((e) => ({
    ...e,
    mode: effectiveMode(e.paymentMode, centreMode),
  }));

  const termOpts = terms.map((x) => ({
    id: x.id,
    label: locale === "ar" ? x.nameAr : x.nameEn,
    startDate: x.startDate.toISOString().slice(0, 10),
    endDate: x.endDate.toISOString().slice(0, 10),
  }));
  const now = new Date();
  const currentTerm =
    terms.find((x) => x.startDate <= now && x.endDate >= now) ?? null;

  const payoutRows: PayoutRow[] = payouts.map((p) => ({
    id: p.id,
    teacherName: displayName(p.teacher, locale),
    periodStart: p.periodStart.toISOString().slice(0, 10),
    periodEnd: p.periodEnd.toISOString().slice(0, 10),
    grossCommission: toNumber(p.grossCommission),
    expectedCommission: toNumber(p.expectedCommission),
    fixedSalary: toNumber(p.fixedSalary),
    deductions: toNumber(p.deductions),
    advances: toNumber(p.advances),
    netPaid: toNumber(p.netPaid),
    status: p.status,
    payMode: p.payMode,
    earnMode: p.earnMode,
  }));

  return (
    <div>
      <PageHeader title={t("title")} />
      <PayrollClient
        earnings={earningsWithMode}
        payouts={payoutRows}
        period={period}
        filter={filter}
        currency={currency}
        locale={locale}
        terms={termOpts}
        currentTermId={currentTerm?.id ?? null}
        defaultMonth={monthOf(today)}
      />
    </div>
  );
}
