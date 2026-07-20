"use client";

import { useMemo } from "react";

import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil } from "lucide-react";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { DeleteButton } from "@/components/crud/delete-button";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
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
import { formatMoney } from "@/lib/money";
import { saveExpense, deleteExpense } from "./actions";

export type CatOpt = { id: string; label: string };
export type ExpenseRow = {
  id: string;
  date: string;
  description: string;
  categoryId: string;
  categoryLabel: string;
  amount: number;
  paidTo: string | null;
  receiptNo: string | null;
};

function Fields({ expense, categories }: { expense?: ExpenseRow; categories: CatOpt[] }) {
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const today = new Date().toISOString().slice(0, 10);
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

export function ExpensesClient({
  expenses,
  categories,
  currency,
}: {
  expenses: ExpenseRow[];
  categories: CatOpt[];
  currency: string;
}) {
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const locale = useLocale();
  const search = useTableSearch(expenses, (e) => [e.description, e.categoryLabel, e.paidTo, e.receiptNo, e.date]);
  const columns = useMemo<ColumnDef<ExpenseRow>[]>(
    () => [
      { key: "date", label: tc("date"), type: "date", value: (e) => e.date },
      { key: "description", label: t("description"), value: (e) => e.description },
      { key: "category", label: t("category"), value: (e) => e.categoryLabel, filterable: true },
      { key: "paidTo", label: t("paidTo"), value: (e) => e.paidTo },
      { key: "amount", label: tc("amount"), type: "number", value: (e) => e.amount, className: "text-end" },
      { key: "actions", label: tc("actions"), className: "text-end" },
    ],
    [t, tc],
  );
  const sf = useTableSortFilter(search.filtered, columns);
  const pg = usePagination(sf.rows, 20, sf.version);

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
          fields={<Fields categories={categories} />}
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
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((e) => (
              <TableRow key={e.id}>
                <TableCell dir="ltr" className="text-start tabular-nums">{e.date}</TableCell>
                <TableCell className="font-medium">{e.description}</TableCell>
                <TableCell>{e.categoryLabel}</TableCell>
                <TableCell>{e.paidTo ?? "—"}</TableCell>
                <TableCell className="text-end tabular-nums font-medium">{formatMoney(e.amount)} {currency}</TableCell>
                <TableCell className="text-end">
                  <div className="flex justify-end gap-1">
                    <EntityDialog
                      title={t("edit")}
                      action={saveExpense.bind(null, locale, e.id)}
                      fields={<Fields expense={e} categories={categories} />}
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    <DeleteButton action={deleteExpense.bind(null, locale, e.id)} />
                  </div>
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
