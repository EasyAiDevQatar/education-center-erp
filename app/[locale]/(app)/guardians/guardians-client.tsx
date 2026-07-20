"use client";

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
import { TableSearch, useTableSearch } from "@/components/ui/table-search";
import { saveGuardian, deleteGuardian } from "./actions";

export type GuardianRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  studentCount: number;
};

function GuardianFields({ guardian }: { guardian?: GuardianRow }) {
  const tc = useTranslations("common");
  return (
    <>
      <FormField label={tc("name")} htmlFor="name">
        <Input id="name" name="name" defaultValue={guardian?.name} required />
      </FormField>
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
  const search = useTableSearch(guardians, (g) => [g.name, g.phone, g.email, g.notes]);
  const pg = usePagination(search.filtered);

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
            <TableRow>
              <TableHead>{tc("name")}</TableHead>
              <TableHead>{tc("phone")}</TableHead>
              <TableHead>{tc("email")}</TableHead>
              <TableHead>{t("students")}</TableHead>
              <TableHead className="text-end">{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {guardians.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((g) => (
              <TableRow key={g.id}>
                <TableCell className="font-medium">{g.name}</TableCell>
                <TableCell dir="ltr" className="text-start">{g.phone ?? "—"}</TableCell>
                <TableCell dir="ltr" className="text-start">{g.email ?? "—"}</TableCell>
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
