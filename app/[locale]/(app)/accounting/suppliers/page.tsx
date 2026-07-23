import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { requireAccounting } from "@/lib/accounting/guard";
import { PageHeader } from "@/components/page-header";
import { SuppliersClient, type SupplierRow } from "./suppliers-client";

export default async function SuppliersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAccounting(locale);
  const t = await getTranslations("suppliers");

  const [suppliers, currencyRow] = await Promise.all([
    db.supplier.findMany({
      orderBy: { name: "asc" },
      include: {
        expenses: { select: { amount: true } },
      },
    }),
    db.setting.findUnique({ where: { key: "currency" } }),
  ]);

  const rows: SupplierRow[] = suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    nameEn: s.nameEn,
    phone: s.phone,
    email: s.email,
    taxNo: s.taxNo,
    address: s.address,
    notes: s.notes,
    active: s.active,
    expenseCount: s.expenses.length,
    expenseTotal: s.expenses.reduce((a, e) => a + toNumber(e.amount), 0),
  }));

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <SuppliersClient suppliers={rows} currency={currencyRow?.value ?? "QAR"} />
    </div>
  );
}
