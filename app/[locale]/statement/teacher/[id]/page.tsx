import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth, FINANCE_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { getTeacherEarnings } from "@/lib/payroll";
import { toNumber, formatMoney, formatHours, formatDate } from "@/lib/money";
import { PrintButton } from "@/components/print-button";
import { displayName, fullName } from "@/lib/names";

/**
 * Printable A4 account statement for one teacher.
 *
 * The mirror image of the student statement: sessions taught are what the
 * centre owes commission on, payouts already issued are what it has settled,
 * and the closing figure is what remains payable.
 */
export default async function TeacherStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  // Finance staff see any statement; a teacher may open only their own.
  const session = await requireAuth(locale);
  const isFinance = FINANCE_ROLES.includes(session.role);
  if (!isFinance && session.teacherId !== id) notFound();

  const sp = await searchParams;
  const get = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const fromStr = get("from");
  const toStr = get("to");
  const from = fromStr ? new Date(`${fromStr}T00:00:00.000Z`) : new Date("2000-01-01T00:00:00.000Z");
  const to = toStr ? new Date(`${toStr}T23:59:59.999Z`) : new Date("2100-01-01T00:00:00.000Z");

  const [teacher, settingsRows, sessions, payouts, earnings] = await Promise.all([
    db.teacher.findUnique({ where: { id } }),
    db.setting.findMany(),
    db.session.findMany({
      where: { teacherId: id, status: { not: "DRAFT" }, date: { gte: from, lte: to } },
      include: { student: true },
      orderBy: { date: "asc" },
    }),
    db.teacherPayout.findMany({
      where: { teacherId: id, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "asc" },
    }),
    getTeacherEarnings(id, from, to),
  ]);
  if (!teacher) notFound();

  const t = await getTranslations("teachers");
  const tc = await getTranslations("common");
  const tp = await getTranslations("profile");
  const te = await getTranslations("enums");
  const ts = await getTranslations("sessions");

  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  const currency = settings.currency ?? "QAR";
  const pct = toNumber(teacher.commissionPct);
  const totalPaidOut = payouts.reduce((sum, p) => sum + toNumber(p.netPaid), 0);
  const dueCommission = earnings?.dueCommission ?? 0;
  const closing = dueCommission - totalPaidOut;

  return (
    <div className="mx-auto max-w-4xl p-6">
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
          <p className="mt-1 text-sm text-muted-foreground">{tp("statement")}</p>
        </div>

        <dl className="mb-5 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{tc("name")}</dt>
            <dd className="font-medium">{fullName(teacher, locale)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t("commissionPct")}</dt>
            <dd className="font-medium tabular-nums">{pct}%</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{tc("period")}</dt>
            <dd className="font-medium tabular-nums" dir="ltr">
              {fromStr || "…"} — {toStr || "…"}
            </dd>
          </div>
        </dl>

        {/* Sessions taught — the basis for commission */}
        <h2 className="mb-2 text-sm font-semibold">{tp("sessions")}</h2>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-y border-border bg-muted/40">
              <th className="p-2">{tc("date")}</th>
              <th className="p-2">{ts("student")}</th>
              <th className="p-2">{tc("status")}</th>
              <th className="p-2">{tc("hours")}</th>
              <th className="p-2">{tc("total")}</th>
              <th className="p-2">{t("commissionDue")}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-muted-foreground">
                  {tc("noData")}
                </td>
              </tr>
            )}
            {sessions.map((s) => (
              <tr key={s.id} className="border-b border-border/60">
                <td className="p-2 tabular-nums"><span dir="ltr">{s.date.toISOString().slice(0, 10)}</span></td>
                <td className="p-2">{displayName(s.student, locale)}</td>
                <td className="p-2">{te(`sessionStatus.${s.status}`)}</td>
                <td className="p-2 tabular-nums">{formatHours(s.hours)}</td>
                <td className="p-2 tabular-nums">{formatMoney(s.total)}</td>
                <td className="p-2 tabular-nums">
                  {formatMoney((toNumber(s.total) * pct) / 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Payouts already issued */}
        <h2 className="mb-2 mt-6 text-sm font-semibold">{tp("payouts")}</h2>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-y border-border bg-muted/40">
              <th className="p-2">{tc("date")}</th>
              <th className="p-2">{tc("period")}</th>
              <th className="p-2">{tc("status")}</th>
              <th className="p-2">{tc("amount")}</th>
            </tr>
          </thead>
          <tbody>
            {payouts.length === 0 && (
              <tr>
                <td colSpan={4} className="p-4 text-center text-muted-foreground">
                  {tc("noData")}
                </td>
              </tr>
            )}
            {payouts.map((p) => (
              <tr key={p.id} className="border-b border-border/60">
                <td className="p-2 tabular-nums"><span dir="ltr">{formatDate(p.createdAt, locale)}</span></td>
                <td className="p-2 tabular-nums">
                  <span dir="ltr">
                    {p.periodStart.toISOString().slice(0, 10)} → {p.periodEnd.toISOString().slice(0, 10)}
                  </span>
                </td>
                <td className="p-2">{te(`payoutStatus.${p.status}`)}</td>
                <td className="p-2 tabular-nums">{formatMoney(p.netPaid)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Reconciliation */}
        <dl className="mt-6 space-y-2 border-t border-border pt-4 text-sm">
          <Row label={t("hoursTaught")} value={formatHours(earnings?.hours ?? 0)} />
          <Row label={t("expectedIncome")} value={`${formatMoney(earnings?.expected ?? 0)} ${currency}`} />
          <Row label={t("collectedIncome")} value={`${formatMoney(earnings?.collected ?? 0)} ${currency}`} />
          <Row label={t("commissionExpected")} value={`${formatMoney(earnings?.expectedCommission ?? 0)} ${currency}`} />
          <Row label={t("commissionDue")} value={`${formatMoney(dueCommission)} ${currency}`} />
          <Row label={tp("payouts")} value={`− ${formatMoney(totalPaidOut)} ${currency}`} />
        </dl>

        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <span className="font-semibold">{t("netPayable")}</span>
          <span className="text-2xl font-bold tabular-nums">
            {formatMoney(closing)} <span className="text-base">{currency}</span>
          </span>
        </div>

        {settings.receiptFooter && (
          <p className="mt-8 text-center text-sm text-muted-foreground">{settings.receiptFooter}</p>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
