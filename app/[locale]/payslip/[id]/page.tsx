import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, FINANCE_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber, formatMoney, formatDate } from "@/lib/money";
import { PrintButton } from "@/components/print-button";

export default async function PayslipPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireRole(locale, FINANCE_ROLES);

  const [payout, settingsRows] = await Promise.all([
    db.teacherPayout.findUnique({ where: { id }, include: { teacher: true } }),
    db.setting.findMany(),
  ]);
  if (!payout) notFound();

  const t = await getTranslations("payroll");
  const tc = await getTranslations("common");
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  const currency = settings.currency ?? "QAR";

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );

  return (
    <div className="mx-auto max-w-md p-6">
      <div className="mb-4 flex justify-end">
        <PrintButton />
      </div>
      <div className="rounded-lg border border-border bg-card p-8 shadow-sm print:border-0 print:shadow-none">
        <div className="mb-6 border-b border-border pb-4 text-center">
          <h1 className="text-xl font-bold">{settings.centerName ?? tc("appShort")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("payslip")}</p>
        </div>
        <dl className="space-y-3 text-sm">
          <Row label={tc("name")} value={payout.teacher.name} />
          <Row
            label={t("period")}
            value={`${formatDate(payout.periodStart, locale)} — ${formatDate(payout.periodEnd, locale)}`}
          />
          <Row label={t("grossCommission")} value={`${formatMoney(toNumber(payout.grossCommission))} ${currency}`} />
          <Row label={t("advances")} value={`${formatMoney(toNumber(payout.advances))} ${currency}`} />
        </dl>
        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <span className="font-semibold">{t("netPaid")}</span>
          <span className="text-2xl font-bold tabular-nums">
            {formatMoney(toNumber(payout.netPaid))} <span className="text-base">{currency}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
