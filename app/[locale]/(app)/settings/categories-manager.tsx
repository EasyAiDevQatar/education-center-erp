"use client";

import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil } from "lucide-react";
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
import { saveExpenseCategory, deleteExpenseCategory } from "./actions";

export type CategoryRow = {
  id: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
  active: boolean;
};

function Fields({ cat }: { cat?: CategoryRow }) {
  const t = useTranslations("settings");
  return (
    <>
      <FormField label={t("nameAr")} htmlFor="nameAr">
        <Input id="nameAr" name="nameAr" defaultValue={cat?.nameAr} required />
      </FormField>
      <FormField label={t("nameEn")} htmlFor="nameEn">
        <Input id="nameEn" name="nameEn" dir="ltr" defaultValue={cat?.nameEn} required />
      </FormField>
      <FormField label="#" htmlFor="sortOrder">
        <Input id="sortOrder" name="sortOrder" type="number" dir="ltr" defaultValue={cat?.sortOrder ?? 0} className="w-24" />
      </FormField>
      <input type="hidden" name="active" value="true" />
    </>
  );
}

export function CategoriesManager({ categories }: { categories: CategoryRow[] }) {
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const locale = useLocale();
  const pg = usePagination(categories);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <EntityDialog
          title={t("add")}
          action={saveExpenseCategory.bind(null, locale, null)}
          fields={<Fields />}
          trigger={
            <Button size="sm" className="gap-2">
              <Plus className="size-4" />
              {tc("add")}
            </Button>
          }
        />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("category")}</TableHead>
            <TableHead>{tc("actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pg.pageItems.map((c) => (
            <TableRow key={c.id}>
              <TableCell>{locale === "ar" ? c.nameAr : c.nameEn}</TableCell>
              <TableCell>
                <div className="flex justify-center gap-1">
                  <EntityDialog
                    title={t("edit")}
                    action={saveExpenseCategory.bind(null, locale, c.id)}
                    fields={<Fields cat={c} />}
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                        <Pencil className="size-4" />
                      </Button>
                    }
                  />
                  <DeleteButton action={deleteExpenseCategory.bind(null, locale, c.id)} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination {...pg} />
    </div>
  );
}
