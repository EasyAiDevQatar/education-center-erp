"use client";

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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePagination, TablePagination } from "@/components/ui/table-pagination";
import { saveSubject, deleteSubject } from "./actions";

export type SubjectRow = {
  id: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
  active: boolean;
  /** Teachers who teach it — shown so an admin sees a subject isn't orphaned. */
  teacherCount: number;
};

function Fields({ subject }: { subject?: SubjectRow }) {
  const t = useTranslations("subjects");
  const ts = useTranslations("settings");
  return (
    <>
      <FormField label={ts("nameAr")} htmlFor="nameAr">
        <Input id="nameAr" name="nameAr" defaultValue={subject?.nameAr} required />
      </FormField>
      <FormField label={ts("nameEn")} htmlFor="nameEn">
        <Input id="nameEn" name="nameEn" dir="ltr" defaultValue={subject?.nameEn} required />
      </FormField>
      <FormField label={t("sortOrder")} htmlFor="sortOrder">
        <Input
          id="sortOrder"
          name="sortOrder"
          type="number"
          dir="ltr"
          defaultValue={subject?.sortOrder ?? 0}
          className="w-24"
        />
      </FormField>
      <input type="hidden" name="active" value="true" />
    </>
  );
}

export function SubjectsManager({ subjects }: { subjects: SubjectRow[] }) {
  const t = useTranslations("subjects");
  const tc = useTranslations("common");
  const locale = useLocale();
  const pg = usePagination(subjects);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("manageHint")}</p>
        <EntityDialog
          title={t("add")}
          action={saveSubject.bind(null, locale, null)}
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
            <TableHead>{t("name")}</TableHead>
            <TableHead>{t("teachers")}</TableHead>
            <TableHead />
            <TableHead>{tc("actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pg.total === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                {tc("noData")}
              </TableCell>
            </TableRow>
          )}
          {pg.pageItems.map((sbj) => (
            <TableRow key={sbj.id} className={sbj.active ? undefined : "opacity-60"}>
              <TableCell className="font-medium">
                {locale === "ar" ? sbj.nameAr : sbj.nameEn}
              </TableCell>
              <TableCell className="tabular-nums">{sbj.teacherCount}</TableCell>
              <TableCell>
                {!sbj.active && <Badge variant="muted">{tc("inactive")}</Badge>}
              </TableCell>
              <TableCell>
                <div className="flex justify-center gap-1">
                  <EntityDialog
                    title={t("edit")}
                    action={saveSubject.bind(null, locale, sbj.id)}
                    fields={<Fields subject={sbj} />}
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                        <Pencil className="size-4" />
                      </Button>
                    }
                  />
                  <DeleteButton action={deleteSubject.bind(null, locale, sbj.id)} />
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
