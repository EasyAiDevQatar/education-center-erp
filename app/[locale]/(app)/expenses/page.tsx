import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, FINANCE_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { ExpensesClient, type ExpenseRow, type CatOpt } from "./expenses-client";

export default async function ExpensesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, FINANCE_ROLES);

  const t = await getTranslations("expenses");
  const [expenses, categories, settingsRow] = await Promise.all([
    db.expense.findMany({
      orderBy: { date: "desc" },
      take: 500,
      include: { category: true },
    }),
    db.expenseCategory.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.setting.findUnique({ where: { key: "currency" } }),
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
    receiptNo: e.receiptNo,
  }));
  const catOpts: CatOpt[] = categories.map((c) => ({ id: c.id, label: label(c.nameAr, c.nameEn) }));

  return (
    <div>
      <PageHeader title={t("title")} />
      <ExpensesClient expenses={rows} categories={catOpts} currency={currency} />
    </div>
  );
}
