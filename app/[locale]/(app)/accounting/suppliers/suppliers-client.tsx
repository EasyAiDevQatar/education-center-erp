"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil } from "lucide-react";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { DeleteButton } from "@/components/crud/delete-button";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SortableTableHeader,
  useTableSortFilter,
  type ColumnDef,
} from "@/components/ui/table-sort";
import { usePagination, TablePagination } from "@/components/ui/table-pagination";
import { TableSearch, useTableSearch } from "@/components/ui/table-search";
import { formatMoney } from "@/lib/money";
import { displayName, nameSearchText } from "@/lib/names";
import { saveSupplier, deleteSupplier } from "./actions";

export type SupplierRow = {
  id: string;
  name: string;
  nameEn: string | null;
  phone: string | null;
  email: string | null;
  taxNo: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  expenseCount: number;
  expenseTotal: number;
};

function Fields({ supplier }: { supplier?: SupplierRow }) {
  const t = useTranslations("suppliers");
  const tc = useTranslations("common");
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={tc("nameAr")} htmlFor="name">
          <Input id="name" name="name" defaultValue={supplier?.name} required />
        </FormField>
        <FormField label={tc("nameEn")} htmlFor="nameEn">
          <Input id="nameEn" name="nameEn" dir="ltr" defaultValue={supplier?.nameEn ?? ""} />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={tc("phone")} htmlFor="phone">
          <Input id="phone" name="phone" dir="ltr" defaultValue={supplier?.phone ?? ""} />
        </FormField>
        <FormField label={t("email")} htmlFor="email">
          <Input id="email" name="email" type="email" dir="ltr" defaultValue={supplier?.email ?? ""} />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("taxNo")} htmlFor="taxNo">
          <Input id="taxNo" name="taxNo" dir="ltr" defaultValue={supplier?.taxNo ?? ""} />
        </FormField>
        <FormField label={t("address")} htmlFor="address">
          <Input id="address" name="address" defaultValue={supplier?.address ?? ""} />
        </FormField>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={supplier?.active ?? true}
          className="size-4 accent-primary"
        />
        {tc("active")}
      </label>
      <FormField label={tc("notes")} htmlFor="notes">
        <Input id="notes" name="notes" defaultValue={supplier?.notes ?? ""} />
      </FormField>
    </>
  );
}

export function SuppliersClient({
  suppliers,
  currency,
}: {
  suppliers: SupplierRow[];
  currency: string;
}) {
  const t = useTranslations("suppliers");
  const tc = useTranslations("common");
  const locale = useLocale();

  const search = useTableSearch(suppliers, (s) => [nameSearchText(s), s.phone, s.email, s.taxNo]);
  const columns = useMemo<ColumnDef<SupplierRow>[]>(
    () => [
      { key: "name", label: tc("name"), value: (s) => displayName(s, locale) },
      { key: "phone", label: tc("phone"), value: (s) => s.phone },
      { key: "expenses", label: t("expensesCount"), type: "number", value: (s) => s.expenseCount, className: "text-end" },
      { key: "total", label: t("expensesTotal"), type: "number", value: (s) => s.expenseTotal, className: "text-end" },
      {
        key: "status",
        label: tc("status"),
        type: "enum",
        value: (s) => (s.active ? "active" : "inactive"),
        filterable: true,
        options: ["active", "inactive"],
        optionLabel: (v) => tc(v as "active"),
      },
      { key: "actions", label: tc("actions"), className: "text-end" },
    ],
    [t, tc, locale],
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
          action={saveSupplier.bind(null, locale, null)}
          fields={<Fields />}
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
            {pg.pageItems.map((s) => (
              <TableRow key={s.id} className={s.active ? undefined : "opacity-60"}>
                <TableCell className="font-medium">{displayName(s, locale)}</TableCell>
                <TableCell className="text-start"><span dir="ltr">{s.phone ?? "—"}</span></TableCell>
                <TableCell className="text-end tabular-nums">{s.expenseCount}</TableCell>
                <TableCell className="text-end tabular-nums" dir="ltr">
                  {formatMoney(s.expenseTotal)} {currency}
                </TableCell>
                <TableCell>
                  {s.active ? (
                    <Badge variant="success">{tc("active")}</Badge>
                  ) : (
                    <Badge variant="muted">{tc("inactive")}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-end">
                  <div className="flex justify-end gap-1">
                    <EntityDialog
                      title={t("edit")}
                      action={saveSupplier.bind(null, locale, s.id)}
                      fields={<Fields supplier={s} />}
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    {s.expenseCount === 0 && (
                      <DeleteButton action={deleteSupplier.bind(null, locale, s.id)} />
                    )}
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
