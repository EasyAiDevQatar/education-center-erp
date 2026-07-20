"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, CalendarRange, Users } from "lucide-react";
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
  saveTerm,
  deleteTerm,
  saveDefaultPaymentMode,
  applyPaymentModeToAll,
} from "./terms-actions";

export type TermRow = {
  id: string;
  nameAr: string;
  nameEn: string;
  startDate: string;
  endDate: string;
  active: boolean;
  current: boolean;
};

function TermFields({ term }: { term?: TermRow }) {
  const t = useTranslations("terms");
  const ts = useTranslations("settings");
  const tc = useTranslations("common");
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={ts("nameAr")} htmlFor="nameAr">
          <Input id="nameAr" name="nameAr" defaultValue={term?.nameAr} required />
        </FormField>
        <FormField label={ts("nameEn")} htmlFor="nameEn">
          <Input id="nameEn" name="nameEn" dir="ltr" defaultValue={term?.nameEn} required />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("startDate")} htmlFor="startDate">
          <Input id="startDate" name="startDate" type="date" dir="ltr" defaultValue={term?.startDate} required />
        </FormField>
        <FormField label={t("endDate")} htmlFor="endDate">
          <Input id="endDate" name="endDate" type="date" dir="ltr" defaultValue={term?.endDate} required />
        </FormField>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={term?.active ?? true}
          className="size-4 accent-[var(--primary)]"
        />
        {tc("active")}
      </label>
    </>
  );
}

export function TermsManager({
  terms,
  defaultPaymentMode,
}: {
  terms: TermRow[];
  defaultPaymentMode: string;
}) {
  const t = useTranslations("terms");
  const tc = useTranslations("common");
  const tm = useTranslations("paymentModes");
  const tt = useTranslations("teachers");
  const locale = useLocale();
  const pg = usePagination(terms);

  const [mode, setMode] = useState(defaultPaymentMode);
  const [bulkMode, setBulkMode] = useState("inherit");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      {/* Teacher payment mode */}
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">{t("paymentSettings")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("centreDefaultMode")}</label>
            <Select value={mode} onChange={(e) => setMode(e.target.value)} className="w-44">
              <option value="SESSION">{tm("SESSION")}</option>
              <option value="MONTH">{tm("MONTH")}</option>
              <option value="TERM">{tm("TERM")}</option>
            </Select>
          </div>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await saveDefaultPaymentMode(locale, mode);
                setMsg(r.ok ? t("saved") : (r.error ?? "error"));
              })
            }
          >
            {tc("save")}
          </Button>

          <div className="ms-auto flex items-end gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">{t("applyToAll")}</label>
              <Select value={bulkMode} onChange={(e) => setBulkMode(e.target.value)} className="w-44">
                <option value="inherit">{tt("paymentModeDefault")}</option>
                <option value="SESSION">{tm("SESSION")}</option>
                <option value="MONTH">{tm("MONTH")}</option>
                <option value="TERM">{tm("TERM")}</option>
              </Select>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="gap-1"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await applyPaymentModeToAll(locale, bulkMode);
                  setMsg(r.ok ? t("appliedToAll", { n: r.count ?? 0 }) : (r.error ?? "error"));
                })
              }
            >
              <Users className="size-4" />
              {t("applyBulk")}
            </Button>
          </div>
        </div>
        {msg && <p className="mt-2 text-sm text-[var(--success)]">{msg}</p>}
      </div>

      {/* Terms */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <CalendarRange className="size-4" />
            {t("title")}
          </p>
          <EntityDialog
            title={t("add")}
            action={saveTerm.bind(null, locale, null)}
            fields={<TermFields />}
            trigger={
              <Button size="sm" className="gap-2">
                <Plus className="size-4" />
                {t("add")}
              </Button>
            }
          />
        </div>

        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc("name")}</TableHead>
                <TableHead>{t("startDate")}</TableHead>
                <TableHead>{t("endDate")}</TableHead>
                <TableHead>{tc("status")}</TableHead>
                <TableHead className="text-end">{tc("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {terms.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    {tc("noData")}
                  </TableCell>
                </TableRow>
              )}
              {pg.pageItems.map((term) => (
                <TableRow key={term.id}>
                  <TableCell className="font-medium">
                    {locale === "ar" ? term.nameAr : term.nameEn}
                    {term.current && (
                      <Badge variant="success" className="ms-2">{t("current")}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-start tabular-nums"><span dir="ltr">{term.startDate}</span></TableCell>
                  <TableCell className="text-start tabular-nums"><span dir="ltr">{term.endDate}</span></TableCell>
                  <TableCell>
                    <Badge variant={term.active ? "success" : "muted"}>
                      {term.active ? tc("active") : tc("inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-1">
                      <EntityDialog
                        title={t("edit")}
                        action={saveTerm.bind(null, locale, term.id)}
                        fields={<TermFields term={term} />}
                        trigger={
                          <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                            <Pencil className="size-4" />
                          </Button>
                        }
                      />
                      <DeleteButton action={deleteTerm.bind(null, locale, term.id)} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination {...pg} />
        </div>
      </div>
    </div>
  );
}
