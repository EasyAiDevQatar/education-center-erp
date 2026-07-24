import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { toNumber, formatMoney } from "@/lib/money";
import { requireAccounting } from "@/lib/accounting/guard";
import { trialBalance, profitAndLoss, type LedgerRow } from "@/lib/accounting/reports";
import type { AccountType } from "@/lib/enums";
import { PageHeader } from "@/components/page-header";
import { PrintButton } from "@/components/print-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export default async function AccountingReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAccounting(locale);
  const t = await getTranslations("accounting");
  const tc = await getTranslations("common");

  const sp = await searchParams;
  const get = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const fromStr = get("from");
  const toStr = get("to");

  const [lines, currencyRow] = await Promise.all([
    db.journalLine.findMany({
      where:
        fromStr || toStr
          ? {
              entry: {
                date: {
                  gte: fromStr ? new Date(`${fromStr}T00:00:00.000Z`) : undefined,
                  lte: toStr ? new Date(`${toStr}T23:59:59.999Z`) : undefined,
                },
              },
            }
          : {},
      include: { account: { select: { id: true, code: true, nameAr: true, nameEn: true, type: true } } },
    }),
    db.setting.findUnique({ where: { key: "currency" } }),
  ]);
  const currency = currencyRow?.value ?? "QAR";
  const label = (ar: string, en: string) => (locale === "ar" ? ar : en);

  const rows: LedgerRow[] = lines.map((l) => ({
    accountId: l.account.id,
    accountCode: l.account.code,
    accountName: label(l.account.nameAr, l.account.nameEn),
    accountType: l.account.type as AccountType,
    debit: toNumber(l.debit),
    credit: toNumber(l.credit),
  }));

  const tb = trialBalance(rows);
  const pl = profitAndLoss(rows);
  const money = (v: number) => `${formatMoney(v)} ${currency}`;
  const periodLabel = fromStr || toStr ? `${fromStr || "…"} — ${toStr || "…"}` : t("allTime");

  return (
    <div className="space-y-4">
      <PageHeader title={t("reportsTitle")} description={t("reportsSubtitle")} />

      {/* Period filter (GET form, printable pages stay bookmarkable). */}
      <form className="no-print flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-2">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">{tc("from")}</span>
          <Input type="date" name="from" dir="ltr" defaultValue={fromStr} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">{tc("to")}</span>
          <Input type="date" name="to" dir="ltr" defaultValue={toStr} />
        </label>
        <Button type="submit" variant="outline">{tc("apply")}</Button>
        <div className="ms-auto">
          <PrintButton />
        </div>
      </form>

      <div data-print="A4" className="space-y-6">
        <p className="text-sm text-muted-foreground">
          {periodLabel} — {tb.rows.length} {t("accountsTitle")}
        </p>

        {/* Trial balance */}
        <section className="rounded-lg border border-border bg-card">
          <h2 className="border-b border-border px-4 py-3 font-semibold">{t("trialBalance")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="p-2 font-medium">{t("code")}</th>
                  <th className="p-2 font-medium">{t("account")}</th>
                  <th className="p-2 font-medium">{t("debit")}</th>
                  <th className="p-2 font-medium">{t("credit")}</th>
                  <th className="p-2 font-medium">{t("balance")}</th>
                </tr>
              </thead>
              <tbody>
                {tb.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-muted-foreground">
                      {tc("noData")}
                    </td>
                  </tr>
                )}
                {tb.rows.map((r) => (
                  <tr key={r.accountId} className="border-b border-border/60">
                    <td className="p-2 font-mono"><span dir="ltr">{r.code}</span></td>
                    <td className="p-2">
                      <Link
                        href={`/accounting/accounts/${r.accountId}`}
                        className="hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="p-2 tabular-nums"><span dir="ltr">{formatMoney(r.debit)}</span></td>
                    <td className="p-2 tabular-nums"><span dir="ltr">{formatMoney(r.credit)}</span></td>
                    <td className="p-2 tabular-nums"><span dir="ltr">{formatMoney(r.balance)}</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td className="p-2" colSpan={2}>{tc("total")}</td>
                  <td className="p-2 tabular-nums"><span dir="ltr">{money(tb.totalDebit)}</span></td>
                  <td className="p-2 tabular-nums"><span dir="ltr">{money(tb.totalCredit)}</span></td>
                  <td className="p-2">
                    {Math.abs(tb.totalDebit - tb.totalCredit) < 0.005 ? (
                      <Badge variant="success">{t("balanced")}</Badge>
                    ) : (
                      <Badge variant="destructive">{t("notBalanced")}</Badge>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {/* P&L */}
        <section className="rounded-lg border border-border bg-card">
          <h2 className="border-b border-border px-4 py-3 font-semibold">{t("profitAndLoss")}</h2>
          <div className="grid gap-0 sm:grid-cols-2">
            <div className="border-e border-border">
              <h3 className="bg-muted/40 px-4 py-2 text-sm font-medium">{t("incomeSection")}</h3>
              {pl.income.map((r) => (
                <div key={r.accountId} className="flex justify-between border-b border-border/60 px-4 py-1.5 text-sm">
                  <span>{r.name}</span>
                  <span className="tabular-nums" dir="ltr">{formatMoney(r.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between px-4 py-2 text-sm font-semibold">
                <span>{tc("total")}</span>
                <span className="tabular-nums" dir="ltr">{money(pl.totalIncome)}</span>
              </div>
            </div>
            <div>
              <h3 className="bg-muted/40 px-4 py-2 text-sm font-medium">{t("expenseSection")}</h3>
              {pl.expense.map((r) => (
                <div key={r.accountId} className="flex justify-between border-b border-border/60 px-4 py-1.5 text-sm">
                  <span>{r.name}</span>
                  <span className="tabular-nums" dir="ltr">{formatMoney(r.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between px-4 py-2 text-sm font-semibold">
                <span>{tc("total")}</span>
                <span className="tabular-nums" dir="ltr">{money(pl.totalExpense)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between border-t-2 border-border px-4 py-3 font-semibold">
            <span>{t("netResult")}</span>
            <span className="tabular-nums" dir="ltr">
              <Badge variant={pl.net >= 0 ? "success" : "destructive"}>{money(pl.net)}</Badge>
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
