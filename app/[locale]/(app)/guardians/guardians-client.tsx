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
import { saveGuardian, deleteGuardian } from "./actions";
import { displayName, nameSearchText } from "@/lib/names";

export type GuardianRow = {
  id: string;
  name: string;
  nameEn: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  studentCount: number;
};

function GuardianFields({ guardian }: { guardian?: GuardianRow }) {
  const tc = useTranslations("common");
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={tc("nameAr")} htmlFor="name">
          <Input id="name" name="name" defaultValue={guardian?.name} required />
        </FormField>
        <FormField label={tc("nameEn")} htmlFor="nameEn" hint={tc("nameEnHint")}>
          <Input id="nameEn" name="nameEn" dir="ltr" defaultValue={guardian?.nameEn ?? ""} />
        </FormField>
      </div>
      <FormField label={tc("phone")} htmlFor="phone">
        <Input id="phone" name="phone" dir="ltr" defaultValue={guardian?.phone ?? ""} />
      </FormField>
      <FormField label={tc("email")} htmlFor="email">
        <Input id="email" name="email" type="email" dir="ltr" defaultValue={guardian?.email ?? ""} />
      </FormField>
      <FormField label={tc("notes")} htmlFor="notes">
        <Input id="notes" name="notes" defaultValue={guardian?.notes ?? ""} />
      </FormField>
    </>
  );
}

export function GuardiansClient({ guardians }: { guardians: GuardianRow[] }) {
  const t = useTranslations("guardians");
  const tc = useTranslations("common");
  const tp = useTranslations("profile");
  const locale = useLocale();
  const search = useTableSearch(guardians, (g) => [nameSearchText(g), g.phone, g.email, g.notes]);
  const columns = useMemo<ColumnDef<GuardianRow>[]>(
    () => [
      { key: "name", label: tc("name"), value: (g) => displayName(g, locale) },
      { key: "phone", label: tc("phone"), value: (g) => g.phone },
      { key: "email", label: tc("email"), value: (g) => g.email },
      { key: "students", label: t("students"), type: "number", value: (g) => g.studentCount },
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
          action={saveGuardian.bind(null, locale, null)}
          fields={<GuardianFields />}
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
            {pg.pageItems.map((g) => (
              <TableRow key={g.id}>
                <TableCell className="font-medium">{displayName(g, locale)}</TableCell>
                <TableCell className="text-start"><span dir="ltr">{g.phone ?? "—"}</span></TableCell>
                <TableCell className="text-start"><span dir="ltr">{g.email ?? "—"}</span></TableCell>
                <TableCell className="tabular-nums">{g.studentCount}</TableCell>
                <TableCell className="text-end">
                  <div className="flex justify-end gap-1">
                    <Link href={`/guardians/${g.id}`}>
                      <Button variant="ghost" size="icon" aria-label={tp("view360")}>
                        <CircleUserRound className="size-4" />
                      </Button>
                    </Link>
                    <EntityDialog
                      title={t("edit")}
                      action={saveGuardian.bind(null, locale, g.id)}
                      fields={<GuardianFields guardian={g} />}
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    <DeleteButton action={deleteGuardian.bind(null, locale, g.id)} />
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
