"use client";

import { useMemo, useTransition } from "react";

import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, CheckCircle2 } from "lucide-react";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { DeleteButton } from "@/components/crud/delete-button";
import { RowActions, ViewDialog } from "@/components/crud/row-actions";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePagination, TablePagination } from "@/components/ui/table-pagination";
import {
  useTableSortFilter,
  SortableTableHeader,
  type ColumnDef,
} from "@/components/ui/table-sort";
import { TableSearch, useTableSearch } from "@/components/ui/table-search";
import { useRouter } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { EXPENSE_STATUSES } from "@/lib/enums";
import { localNowTime, localToday } from "@/lib/session-time";
import { saveExpense, deleteExpense, approveExpense } from "./actions";

export type CatOpt = { id: string; label: string };
export type SupplierOpt = { id: string; label: string };
export type ExpenseRow = {
  id: string;
  date: string;
  description: string;
  categoryId: string;
  categoryLabel: string;
  amount: number;
  paidTo: string | null;
  supplierId: string | null;
  supplierLabel: string | null;
  receiptNo: string | null;
  status: string;
};

function Fields({
  expense,
  categories,
  suppliers,
}: {
  expense?: ExpenseRow;
  categories: CatOpt[];
  suppliers: SupplierOpt[];
}) {
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const today = localToday();
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={tc("date")} htmlFor="date">
          <Input id="date" name="date" type="date" dir="ltr" defaultValue={expense?.date ?? today} required />
        </FormField>
        <FormField label={tc("amount")} htmlFor="amount">
          <Input id="amount" name="amount" type="number" step="0.5" min="0" dir="ltr" defaultValue={expense?.amount ?? ""} required />
        </FormField>
      </div>
      <FormField label={t("description")} htmlFor="description">
        <Input id="description" name="description" defaultValue={expense?.description} required />
      </FormField>
      <FormField label={t("category")} htmlFor="categoryId">
        <Select id="categoryId" name="categoryId" defaultValue={expense?.categoryId ?? ""} required>
          <option value="">—</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </Select>
      </FormField>
      {suppliers.length > 0 && (
        <FormField label={t("supplier")} htmlFor="supplierId" hint={t("supplierHint")}>
          <Select id="supplierId" name="supplierId" defaultValue={expense?.supplierId ?? ""}>
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </Select>
        </FormField>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("paidTo")} htmlFor="paidTo">
          <Input id="paidTo" name="paidTo" defaultValue={expense?.paidTo ?? ""} />
        </FormField>
        <FormField label={t("receiptNo")} htmlFor="receiptNo">
          <Input id="receiptNo" name="receiptNo" dir="ltr" defaultValue={expense?.receiptNo ?? ""} />
        </FormField>
      </div>
    </>
  );
}

function ApproveButton({ id }: { id: string }) {
  const t = useTranslations("expenses");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("approve")}
      title={t("approve")}
      disabled={pending}
      onClick={() => start(async () => {
        await approveExpense(locale, id);
        router.refresh();
      })}
    >
      <CheckCircle2 className="size-4 text-[var(--success)]" />
    </Button>
  );
}

const STATUS_BADGE: Record<string, "muted" | "default" | "success"> = {
  DRAFT: "muted",
  APPROVED: "default",
  POSTED: "success",
};

export function ExpensesClient({
  expenses,
  categories,
  suppliers,
  currency,
  accounting,
}: {
  expenses: ExpenseRow[];
  categories: CatOpt[];
  suppliers: SupplierOpt[];
  currency: string;
  /** Accounting module flag — status column and approve button only make
      sense when the journal exists. */
  accounting: boolean;
}) {
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const search = useTableSearch(expenses, (e) => [e.description, e.categoryLabel, e.paidTo, e.supplierLabel, e.receiptNo, e.date]);
  const columns = useMemo<ColumnDef<ExpenseRow>[]>(
    () => [
      { key: "date", label: tc("date"), type: "date", value: (e) => e.date },
      { key: "description", label: t("description"), value: (e) => e.description },
      { key: "category", label: t("category"), value: (e) => e.categoryLabel, filterable: true },
      { key: "paidTo", label: t("paidTo"), value: (e) => e.supplierLabel ?? e.paidTo },
      { key: "amount", label: tc("amount"), type: "number", value: (e) => e.amount },
      ...(accounting
        ? [
            {
              key: "status",
              label: tc("status"),
              type: "enum",
              value: (e) => e.status,
              filterable: true,
              options: [...EXPENSE_STATUSES],
              optionLabel: (v) => te(`expenseStatus.${v}`),
            } as ColumnDef<ExpenseRow>,
          ]
        : []),
      { key: "actions", label: tc("actions") },
    ],
    [t, tc, te, accounting],
  );
  const sf = useTableSortFilter(search.filtered, columns);
  const pg = usePagination(sf.rows, 20, sf.version);
  const colSpan = accounting ? 7 : 6;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <TableSearch
          value={search.query}
          onChange={search.setQuery}
          resultCount={search.filtered.length}
          placeholder={t("searchPlaceholder")}
        />
        <EntityDialog
          title={t("add")}
          action={saveExpense.bind(null, locale, null)}
          fields={<Fields categories={categories} suppliers={suppliers} />}
          trigger={
            <Button className="gap-2">
              <Plus className="size-4" />
              {t("add")}
            </Button>
          }
        />
      </div>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <SortableTableHeader sf={sf} />
          </TableHeader>
          <TableBody>
            {pg.total === 0 && (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="tabular-nums"><span dir="ltr">{e.date}</span></TableCell>
                <TableCell className="font-medium">{e.description}</TableCell>
                <TableCell>{e.categoryLabel}</TableCell>
                <TableCell>{e.supplierLabel ?? e.paidTo ?? "—"}</TableCell>
                <TableCell className="tabular-nums font-medium">{formatMoney(e.amount)} {currency}</TableCell>
                {accounting && (
                  <TableCell>
                    <Badge variant={STATUS_BADGE[e.status] ?? "default"}>
                      {te(`expenseStatus.${e.status as "DRAFT"}`)}
                    </Badge>
                  </TableCell>
                )}
                <TableCell>
                  <RowActions>
                    <ViewDialog
                      title={e.description}
                      subtitle={e.categoryLabel}
                      fields={[
                        { label: tc("date"), value: e.date, ltr: true },
                        { label: t("description"), value: e.description },
                        { label: t("category"), value: e.categoryLabel },
                        { label: t("amount"), value: `${formatMoney(e.amount)} ${currency}`, ltr: true },
                        { label: t("paidTo"), value: e.paidTo },
                        { label: t("supplier"), value: e.supplierLabel },
                        { label: t("receiptNo"), value: e.receiptNo, ltr: true },
                        { label: tc("status"), value: te(`expenseStatus.${e.status}`) },
                      ]}
                    />
                    {accounting && e.status === "DRAFT" && <ApproveButton id={e.id} />}
                    <EntityDialog
                      title={t("edit")}
                      action={saveExpense.bind(null, locale, e.id)}
                      fields={<Fields expense={e} categories={categories} suppliers={suppliers} />}
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    <DeleteButton action={deleteExpense.bind(null, locale, e.id)} />
                  </RowActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination {...pg} />
      </div>
    </>
  );
}
