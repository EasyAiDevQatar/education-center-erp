"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil } from "lucide-react";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { DeleteButton } from "@/components/crud/delete-button";
import { RowActions, ViewDialog } from "@/components/crud/row-actions";
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
      { key: "expenses", label: t("expensesCount"), type: "number", value: (s) => s.expenseCount },
      { key: "total", label: t("expensesTotal"), type: "number", value: (s) => s.expenseTotal },
      {
        key: "status",
        label: tc("status"),
        type: "enum",
        value: (s) => (s.active ? "active" : "inactive"),
        filterable: true,
        options: ["active", "inactive"],
        optionLabel: (v) => tc(v as "active"),
      },
      { key: "actions", label: tc("actions") },
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
                <TableCell><span dir="ltr">{s.phone ?? "—"}</span></TableCell>
                <TableCell className="tabular-nums">{s.expenseCount}</TableCell>
                <TableCell className="tabular-nums">
                  <span dir="ltr">
                    {formatMoney(s.expenseTotal)} {currency}
                  </span>
                </TableCell>
                <TableCell>
                  {s.active ? (
                    <Badge variant="success">{tc("active")}</Badge>
                  ) : (
                    <Badge variant="muted">{tc("inactive")}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <RowActions>
                    <ViewDialog
                      title={displayName(s, locale)}
                      subtitle={s.active ? tc("active") : tc("inactive")}
                      fields={[
                        { label: tc("nameAr"), value: s.name },
                        { label: tc("nameEn"), value: s.nameEn, ltr: true },
                        { label: tc("phone"), value: s.phone, ltr: true },
                        { label: t("email"), value: s.email, ltr: true },
                        { label: t("taxNo"), value: s.taxNo, ltr: true },
                        { label: t("address"), value: s.address },
                        { label: t("expensesCount"), value: s.expenseCount, ltr: true },
                        {
                          label: t("expensesTotal"),
                          value: `${formatMoney(s.expenseTotal)} ${currency}`,
                          ltr: true,
                        },
                        { label: tc("notes"), value: s.notes, wide: true },
                      ]}
                    />
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
