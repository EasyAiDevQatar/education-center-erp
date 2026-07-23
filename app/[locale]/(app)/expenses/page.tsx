import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, FINANCE_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { displayName } from "@/lib/names";
import { accountingEnabled } from "@/lib/accounting/journal-data";
import { PageHeader } from "@/components/page-header";
import { ExpensesClient, type ExpenseRow, type CatOpt, type SupplierOpt } from "./expenses-client";

export default async function ExpensesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, FINANCE_ROLES);

  const t = await getTranslations("expenses");
  const [expenses, categories, suppliers, settingsRow, accounting] = await Promise.all([
    db.expense.findMany({
      orderBy: { date: "desc" },
      take: 500,
      include: { category: true, supplier: true },
    }),
    db.expenseCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.setting.findUnique({ where: { key: "currency" } }),
    accountingEnabled(),
  ]);

  const currency = settingsRow?.value ?? "QAR";
  const label = (ar: string, en: string) => (locale === "ar" ? ar : en);
  const rows: ExpenseRow[] = expenses.map((e) => ({
    id: e.id,
    date: e.date.toISOString().slice(0, 10),
    description: e.description,
    categoryId: e.categoryId,
    categoryLabel: label(e.category.nameAr, e.category.nameEn),
    amount: toNumber(e.amount),
    paidTo: e.paidTo,
    supplierId: e.supplierId,
    supplierLabel: e.supplier ? displayName(e.supplier, locale) : null,
    receiptNo: e.receiptNo,
    status: e.status,
  }));
  const catOpts: CatOpt[] = categories.map((c) => ({ id: c.id, label: label(c.nameAr, c.nameEn) }));
  const supplierOpts: SupplierOpt[] = suppliers.map((s) => ({
    id: s.id,
    label: displayName(s, locale),
  }));

  return (
    <div>
      <PageHeader title={t("title")} />
      <ExpensesClient
        expenses={rows}
        categories={catOpts}
        suppliers={supplierOpts}
        currency={currency}
        accounting={accounting}
      />
    </div>
  );
}
