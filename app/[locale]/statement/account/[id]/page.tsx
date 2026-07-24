import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, FINANCE_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber, formatMoney, formatDate } from "@/lib/money";
import { accountStatement } from "@/lib/accounting/reports";
import type { AccountType } from "@/lib/enums";
import { PrintButton } from "@/components/print-button";

/** Printable A4 ledger statement for one account (letterhead pattern). */
export default async function AccountStatementPrintPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireRole(locale, FINANCE_ROLES);

  const [account, settingsRows] = await Promise.all([
    db.account.findUnique({
      where: { id },
      include: {
        lines: {
          include: { entry: { select: { date: true, memo: true } } },
          orderBy: { entry: { date: "asc" } },
        },
      },
    }),
    db.setting.findMany(),
  ]);
  if (!account) notFound();

  const t = await getTranslations("accounting");
  const tc = await getTranslations("common");
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  const currency = settings.currency ?? "QAR";
  const name = locale === "ar" ? account.nameAr : account.nameEn;

  const rows = accountStatement(
    account.lines.map((l) => ({
      date: l.entry.date.toISOString().slice(0, 10),
      memo: l.memo ?? l.entry.memo,
      debit: toNumber(l.debit),
      credit: toNumber(l.credit),
    })),
    account.type as AccountType,
  );
  const closing = rows.length ? rows[rows.length - 1].balance : 0;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="no-print mb-4 flex justify-end">
        <PrintButton />
      </div>

      <div data-print="A4" className="rounded-lg border border-border bg-card p-8 shadow-sm">
        {/* Letterhead */}
        <div className="mb-6 flex items-start justify-between gap-4 border-b border-border pb-4">
          <div className="flex items-center gap-3">
            {settings.centerLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={settings.centerLogo} alt="" className="max-h-16 object-contain" />
            )}
            <div>
              <h1 className="text-xl font-bold">{settings.centerName ?? tc("appShort")}</h1>
              {settings.centerAddress && (
                <p className="text-xs text-muted-foreground">{settings.centerAddress}</p>
              )}
            </div>
          </div>
          <div className="text-end">
            <p className="font-semibold">{t("statementTitle")}</p>
            <p className="text-sm">{account.code} — {name}</p>
            <p className="text-xs tabular-nums text-muted-foreground" dir="ltr">
              {formatDate(new Date(), locale)}
            </p>
          </div>
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-border text-start">
              <th className="p-2 text-start font-medium">{tc("date")}</th>
              <th className="p-2 text-start font-medium">{t("memo")}</th>
              <th className="p-2 text-end font-medium">{t("debit")}</th>
              <th className="p-2 text-end font-medium">{t("credit")}</th>
              <th className="p-2 text-end font-medium">{t("balance")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/60">
                <td className="p-2 tabular-nums"><span dir="ltr">{formatDate(r.date, locale)}</span></td>
                <td className="p-2">{r.memo}</td>
                <td className="p-2 text-end tabular-nums">
                  <span dir="ltr">
                    {r.debit > 0 ? formatMoney(r.debit) : ""}
                  </span>
                </td>
                <td className="p-2 text-end tabular-nums">
                  <span dir="ltr">
                    {r.credit > 0 ? formatMoney(r.credit) : ""}
                  </span>
                </td>
                <td className="p-2 text-end tabular-nums"><span dir="ltr">{formatMoney(r.balance)}</span></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="p-2" colSpan={4}>{t("closingBalance")}</td>
              <td className="p-2 text-end tabular-nums">
                <span dir="ltr">
                  {formatMoney(closing)} {currency}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
