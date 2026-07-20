"use client";

import { useLocale, useTranslations } from "next-intl";
import { SectionForm } from "@/components/crud/section-form";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { savePriceMatrix } from "./actions";

export type MatrixRow = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  center: number | null;
  home: number | null;
};

export function PriceMatrixEditor({ rows }: { rows: MatrixRow[] }) {
  const t = useTranslations("settings");
  const te = useTranslations("enums");
  const tc = useTranslations("common");
  const locale = useLocale();

  return (
    <SectionForm action={savePriceMatrix.bind(null, locale)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("gradeLevels")}</TableHead>
            <TableHead>{te("location.CENTER")}</TableHead>
            <TableHead>{te("location.HOME")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">
                {locale === "ar" ? r.nameAr : r.nameEn}
                <span className="ms-2 text-xs text-muted-foreground">{r.code}</span>
              </TableCell>
              <TableCell>
                <Input
                  name={`center_${r.id}`}
                  type="number"
                  step="5"
                  min="0"
                  dir="ltr"
                  defaultValue={r.center ?? ""}
                  className="w-28"
                />
              </TableCell>
              <TableCell>
                <Input
                  name={`home_${r.id}`}
                  type="number"
                  step="5"
                  min="0"
                  dir="ltr"
                  defaultValue={r.home ?? ""}
                  className="w-28"
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        {tc("currency")} / {tc("hours")}
      </p>
    </SectionForm>
  );
}
