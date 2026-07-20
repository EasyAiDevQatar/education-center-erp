import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth, FINANCE_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber, formatMoney, formatDate, formatHours } from "@/lib/money";
import { PrintButton } from "@/components/print-button";

export default async function PayslipPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  // Finance staff see any payslip; a teacher may open their own and no other.
  const session = await requireAuth(locale);
  const isFinance = FINANCE_ROLES.includes(session.role);

  const [payout, settingsRows] = await Promise.all([
    db.teacherPayout.findUnique({
      where: { id },
      include: { teacher: true, term: true },
    }),
    db.setting.findMany(),
  ]);
  if (!payout) notFound();
  // Not `forbidden` — a teacher probing ids shouldn't learn which ones exist.
  if (!isFinance && payout.teacherId !== session.teacherId) notFound();

  const t = await getTranslations("payroll");
  const tc = await getTranslations("common");
  const tt = await getTranslations("teachers");
  const tm = await getTranslations("paymentModes");
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  const currency = settings.currency ?? "QAR";

  // SESSION-mode payslips itemise every session in the period.
  const lines =
    payout.payMode === "SESSION"
      ? await db.session.findMany({
          where: {
            teacherId: payout.teacherId,
            date: { gte: payout.periodStart, lte: payout.periodEnd },
            status: { not: "DRAFT" },
          },
          include: { student: true },
          orderBy: { date: "asc" },
        })
      : [];

  const pct = toNumber(payout.teacher.commissionPct);

  const Row = ({
    label,
    value,
    strong,
  }: {
    label: string;
    value: string;
    strong?: boolean;
  }) => (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? "font-semibold tabular-nums" : "font-medium tabular-nums"}>{value}</dd>
    </div>
  );

  const money = (n: number) => `${formatMoney(n)} ${currency}`;

  return (
    <div className={payout.payMode === "SESSION" ? "mx-auto max-w-2xl p-6" : "mx-auto max-w-md p-6"}>
      <div className="no-print mb-4 flex justify-end">
        <PrintButton />
      </div>
      <div data-print="A4" className="rounded-lg border border-border bg-card p-8 shadow-sm">
        <div className="mb-6 border-b border-border pb-4 text-center">
          {settings.centerLogo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={settings.centerLogo} alt="" className="mx-auto mb-2 max-h-16 object-contain" />
          )}
          <h1 className="text-xl font-bold">{settings.centerName ?? tc("appShort")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("payslip")}</p>
        </div>

        <dl className="space-y-3 text-sm">
          <Row label={tc("name")} value={payout.teacher.name} />
          {payout.payMode && <Row label={t("payMode")} value={tm(payout.payMode as "MONTH")} />}
          {payout.term && (
            <Row label={t("term")} value={locale === "ar" ? payout.term.nameAr : payout.term.nameEn} />
          )}
          <Row
            label={t("period")}
            value={`${formatDate(payout.periodStart, locale)} — ${formatDate(payout.periodEnd, locale)}`}
          />
        </dl>

        {/* Itemised sessions (SESSION mode only) */}
        {lines.length > 0 && (
          <table className="mt-5 w-full border-collapse text-xs">
            <thead>
              <tr className="border-y border-border bg-muted/40">
                <th className="p-2 text-start">{tc("date")}</th>
                <th className="p-2 text-start">{t("student")}</th>
                <th className="p-2 text-end">{tc("hours")}</th>
                <th className="p-2 text-end">{tc("total")}</th>
                <th className="p-2 text-end">{tt("commissionDue")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((s) => (
                <tr key={s.id} className="border-b border-border/60">
                  <td className="p-2 tabular-nums" dir="ltr">{s.date.toISOString().slice(0, 10)}</td>
                  <td className="p-2">{s.student.name}</td>
                  <td className="p-2 text-end tabular-nums">{formatHours(s.hours)}</td>
                  <td className="p-2 text-end tabular-nums">{formatMoney(s.total)}</td>
                  <td className="p-2 text-end tabular-nums">
                    {formatMoney((toNumber(s.total) * pct) / 100)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Money breakdown */}
        <dl className="mt-5 space-y-3 border-t border-border pt-4 text-sm">
          <Row label={tt("commissionExpected")} value={money(toNumber(payout.expectedCommission))} />
          <Row label={tt("commissionDue")} value={money(toNumber(payout.grossCommission))} />
          <Row label={t("fixedSalary")} value={money(toNumber(payout.fixedSalary))} />
          <Row label={t("deductions")} value={`− ${money(toNumber(payout.deductions))}`} />
          <Row label={t("advances")} value={`− ${money(toNumber(payout.advances))}`} />
        </dl>

        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <span className="font-semibold">{t("netPaid")}</span>
          <span className="text-2xl font-bold tabular-nums">
            {formatMoney(toNumber(payout.netPaid))} <span className="text-base">{currency}</span>
          </span>
        </div>

        {settings.receiptFooter && (
          <p className="mt-8 text-center text-sm text-muted-foreground">{settings.receiptFooter}</p>
        )}
      </div>
    </div>
  );
}
