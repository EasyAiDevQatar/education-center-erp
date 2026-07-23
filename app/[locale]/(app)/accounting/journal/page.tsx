import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { requireAccounting } from "@/lib/accounting/guard";
import { PageHeader } from "@/components/page-header";
import { JournalClient, type EntryRow, type AccountOpt } from "./journal-client";

export default async function JournalPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAccounting(locale);
  const t = await getTranslations("accounting");

  const [entries, accounts, currencyRow] = await Promise.all([
    db.journalEntry.findMany({
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 1000,
      include: {
        lines: { include: { account: { select: { code: true, nameAr: true, nameEn: true } } } },
      },
    }),
    db.account.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.setting.findUnique({ where: { key: "currency" } }),
  ]);

  const label = (ar: string, en: string) => (locale === "ar" ? ar : en);
  const rows: EntryRow[] = entries.map((e) => ({
    id: e.id,
    date: e.date.toISOString().slice(0, 10),
    memo: e.memo,
    sourceType: e.sourceType,
    total: e.lines.reduce((a, l) => a + toNumber(l.debit), 0),
    lines: e.lines.map((l) => ({
      id: l.id,
      account: `${l.account.code} — ${label(l.account.nameAr, l.account.nameEn)}`,
      debit: toNumber(l.debit),
      credit: toNumber(l.credit),
      memo: l.memo,
    })),
  }));

  const accountOpts: AccountOpt[] = accounts.map((a) => ({
    id: a.id,
    label: `${a.code} — ${label(a.nameAr, a.nameEn)}`,
  }));

  return (
    <div>
      <PageHeader title={t("journalTitle")} description={t("journalSubtitle")} />
      <JournalClient
        entries={rows}
        accounts={accountOpts}
        currency={currencyRow?.value ?? "QAR"}
      />
    </div>
  );
}
