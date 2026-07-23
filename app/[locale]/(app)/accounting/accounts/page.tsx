import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireAccounting } from "@/lib/accounting/guard";
import { PageHeader } from "@/components/page-header";
import { AccountsClient, type AccountRow } from "./accounts-client";

export default async function AccountsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAccounting(locale);
  const t = await getTranslations("accounting");

  const accounts = await db.account.findMany({
    orderBy: { code: "asc" },
    include: {
      parent: { select: { code: true, nameAr: true, nameEn: true } },
      _count: { select: { lines: true } },
    },
  });

  const label = (ar: string, en: string) => (locale === "ar" ? ar : en);
  const rows: AccountRow[] = accounts.map((a) => ({
    id: a.id,
    code: a.code,
    nameAr: a.nameAr,
    nameEn: a.nameEn,
    name: label(a.nameAr, a.nameEn),
    type: a.type as AccountRow["type"],
    parentId: a.parentId,
    parentLabel: a.parent ? `${a.parent.code} — ${label(a.parent.nameAr, a.parent.nameEn)}` : null,
    system: a.system,
    active: a.active,
    notes: a.notes,
    lineCount: a._count.lines,
  }));

  return (
    <div>
      <PageHeader title={t("accountsTitle")} description={t("accountsSubtitle")} />
      <AccountsClient accounts={rows} />
    </div>
  );
}
