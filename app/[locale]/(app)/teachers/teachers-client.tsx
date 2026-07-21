"use client";

import { useMemo } from "react";

import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, CircleUserRound } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { DeleteButton } from "@/components/crud/delete-button";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
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
import { saveTeacher, deleteTeacher } from "./actions";
import { displayName, nameSearchText } from "@/lib/names";
import { EARNINGS_MODES } from "@/lib/earnings-mode";

export type TeacherRow = {
  id: string;
  name: string;
  nameEn: string | null;
  phone: string | null;
  commissionPct: number;
  fixedSalary: number;
  fixedDeductions: number;
  /** null = inherit the centre default payment mode. */
  paymentMode: string | null;
  /** null = inherit the centre default earnings mode. */
  earningsMode: string | null;
  active: boolean;
  notes: string | null;
};

function TeacherFields({ teacher }: { teacher?: TeacherRow }) {
  const t = useTranslations("teachers");
  const tc = useTranslations("common");
  const tm = useTranslations("paymentModes");
  const tem = useTranslations("earningsModes");
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={tc("nameAr")} htmlFor="name">
          <Input id="name" name="name" defaultValue={teacher?.name} required />
        </FormField>
        <FormField label={tc("nameEn")} htmlFor="nameEn" hint={tc("nameEnHint")}>
          <Input id="nameEn" name="nameEn" dir="ltr" defaultValue={teacher?.nameEn ?? ""} />
        </FormField>
      </div>
      <FormField label={tc("phone")} htmlFor="phone">
        <Input id="phone" name="phone" dir="ltr" defaultValue={teacher?.phone ?? ""} />
      </FormField>
      <FormField label={t("commissionPct")} htmlFor="commissionPct">
        <Input
          id="commissionPct"
          name="commissionPct"
          type="number"
          step="0.5"
          min="0"
          max="100"
          dir="ltr"
          defaultValue={teacher?.commissionPct ?? 0}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("fixedSalary")} htmlFor="fixedSalary">
          <Input
            id="fixedSalary"
            name="fixedSalary"
            type="number"
            step="0.01"
            min="0"
            dir="ltr"
            defaultValue={teacher?.fixedSalary ?? 0}
          />
        </FormField>
        <FormField label={t("fixedDeductions")} htmlFor="fixedDeductions">
          <Input
            id="fixedDeductions"
            name="fixedDeductions"
            type="number"
            step="0.01"
            min="0"
            dir="ltr"
            defaultValue={teacher?.fixedDeductions ?? 0}
          />
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("earningsMode")} htmlFor="earningsMode" hint={t("earningsModeHint")}>
          <Select id="earningsMode" name="earningsMode" defaultValue={teacher?.earningsMode ?? ""}>
            <option value="">{t("earningsModeDefault")}</option>
            {EARNINGS_MODES.map((m) => (
              <option key={m} value={m}>
                {tem(m)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("paymentMode")} htmlFor="paymentMode" hint={t("paymentModeHint")}>
          <Select id="paymentMode" name="paymentMode" defaultValue={teacher?.paymentMode ?? ""}>
            <option value="">{t("paymentModeDefault")}</option>
            <option value="SESSION">{tm("SESSION")}</option>
            <option value="MONTH">{tm("MONTH")}</option>
            <option value="TERM">{tm("TERM")}</option>
          </Select>
        </FormField>
      </div>
      <FormField label={tc("notes")} htmlFor="notes">
        <Input id="notes" name="notes" defaultValue={teacher?.notes ?? ""} />
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={teacher?.active ?? true}
          className="size-4 accent-[var(--primary)]"
        />
        {tc("active")}
      </label>
    </>
  );
}

export function TeachersClient({ teachers }: { teachers: TeacherRow[] }) {
  const t = useTranslations("teachers");
  const tc = useTranslations("common");
  const tp = useTranslations("profile");
  const locale = useLocale();
  const search = useTableSearch(teachers, (x) => [nameSearchText(x), x.phone, x.notes]);
  const columns = useMemo<ColumnDef<TeacherRow>[]>(
    () => [
      { key: "name", label: tc("name"), value: (x) => displayName(x, locale) },
      { key: "phone", label: tc("phone"), value: (x) => x.phone },
      { key: "commissionPct", label: t("commissionPct"), type: "number", value: (x) => x.commissionPct },
      {
        key: "status",
        label: tc("status"),
        type: "enum",
        value: (x) => (x.active ? "active" : "inactive"),
        filterable: true,
        options: ["active", "inactive"],
        optionLabel: (v) => tc(v as "active"),
      },
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
          action={saveTeacher.bind(null, locale, null)}
          fields={<TeacherFields />}
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
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((teacher) => (
              <TableRow key={teacher.id}>
                <TableCell className="font-medium">{displayName(teacher, locale)}</TableCell>
                <TableCell className="text-start"><span dir="ltr">{teacher.phone ?? "—"}</span></TableCell>
                <TableCell className="tabular-nums">{teacher.commissionPct}%</TableCell>
                <TableCell>
                  {teacher.active ? (
                    <Badge variant="success">{tc("active")}</Badge>
                  ) : (
                    <Badge variant="muted">{tc("inactive")}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-end">
                  <div className="flex justify-end gap-1">
                    <Link href={`/teachers/${teacher.id}`}>
                      <Button variant="ghost" size="icon" aria-label={tp("view360")}>
                        <CircleUserRound className="size-4" />
                      </Button>
                    </Link>
                    <EntityDialog
                      title={t("edit")}
                      action={saveTeacher.bind(null, locale, teacher.id)}
                      fields={<TeacherFields teacher={teacher} />}
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    <DeleteButton action={deleteTeacher.bind(null, locale, teacher.id)} />
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
