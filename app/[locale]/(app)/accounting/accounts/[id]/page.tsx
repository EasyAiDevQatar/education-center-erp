import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Printer } from "lucide-react";
import { db } from "@/lib/db";
import { toNumber, formatMoney, formatDate } from "@/lib/money";
import { requireAccounting } from "@/lib/accounting/guard";
import { accountStatement } from "@/lib/accounting/reports";
import type { AccountType } from "@/lib/enums";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export default async function AccountStatementPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAccounting(locale);
  const t = await getTranslations("accounting");
  const tc = await getTranslations("common");

  const [account, currencyRow] = await Promise.all([
    db.account.findUnique({
      where: { id },
      include: {
        lines: {
          include: { entry: { select: { date: true, memo: true, sourceType: true } } },
          orderBy: { entry: { date: "asc" } },
        },
      },
    }),
    db.setting.findUnique({ where: { key: "currency" } }),
  ]);
  if (!account) notFound();
  const currency = currencyRow?.value ?? "QAR";
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
    <div className="space-y-4">
      <PageHeader
        title={`${t("statementTitle")} — ${account.code} ${name}`}
        description={t("statementSubtitle")}
      />
      <div className="no-print flex gap-2">
        <Link href={`/statement/account/${account.id}`}>
          <Button variant="outline" className="gap-2">
            <Printer className="size-4" />
            {tc("print")}
          </Button>
        </Link>
      </div>
      <div className="rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="p-2 text-start font-medium">{tc("date")}</th>
                <th className="p-2 text-start font-medium">{t("memo")}</th>
                <th className="p-2 text-end font-medium">{t("debit")}</th>
                <th className="p-2 text-end font-medium">{t("credit")}</th>
                <th className="p-2 text-end font-medium">{t("balance")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    {tc("noData")}
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-border/60">
                  <td className="p-2 tabular-nums" dir="ltr">{formatDate(r.date, locale)}</td>
                  <td className="p-2">{r.memo}</td>
                  <td className="p-2 text-end tabular-nums" dir="ltr">
                    {r.debit > 0 ? formatMoney(r.debit) : ""}
                  </td>
                  <td className="p-2 text-end tabular-nums" dir="ltr">
                    {r.credit > 0 ? formatMoney(r.credit) : ""}
                  </td>
                  <td className="p-2 text-end tabular-nums" dir="ltr">{formatMoney(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-semibold">
                <td className="p-2" colSpan={4}>{t("closingBalance")}</td>
                <td className="p-2 text-end tabular-nums" dir="ltr">
                  <Badge variant={closing >= 0 ? "success" : "destructive"}>
                    {formatMoney(closing)} {currency}
                  </Badge>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
