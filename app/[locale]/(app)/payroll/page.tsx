import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, FINANCE_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { getAllTeacherEarnings } from "@/lib/payroll";
import { PageHeader } from "@/components/page-header";
import { PayrollClient, type EarningRow, type PayoutRow } from "./payroll-client";

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

  const [earningsAll, payouts, settingsRow, earliest] = await Promise.all([
    getAllTeacherEarnings(fromDate, toDate),
    db.teacherPayout.findMany({ orderBy: { createdAt: "desc" }, include: { teacher: true } }),
    db.setting.findUnique({ where: { key: "currency" } }),
    db.session.findFirst({ orderBy: { date: "asc" }, select: { date: true } }),
  ]);

  const currency = settingsRow?.value ?? "QAR";
  const earnings: EarningRow[] = earningsAll.filter((e) => e.hours > 0 || e.collected > 0);

  const today = new Date().toISOString().slice(0, 10);
  const period = {
    from: filter.from || (earliest ? earliest.date.toISOString().slice(0, 10) : today),
    to: filter.to || today,
  };

  const payoutRows: PayoutRow[] = payouts.map((p) => ({
    id: p.id,
    teacherName: p.teacher.name,
    periodStart: p.periodStart.toISOString().slice(0, 10),
    periodEnd: p.periodEnd.toISOString().slice(0, 10),
    grossCommission: toNumber(p.grossCommission),
    advances: toNumber(p.advances),
    netPaid: toNumber(p.netPaid),
    status: p.status,
  }));

  return (
    <div>
      <PageHeader title={t("title")} />
      <PayrollClient
        earnings={earnings}
        payouts={payoutRows}
        period={period}
        filter={filter}
        currency={currency}
        locale={locale}
      />
    </div>
  );
}
