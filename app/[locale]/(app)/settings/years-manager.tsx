"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Archive, ArchiveRestore, Star, Trash2, CalendarPlus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
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
import type { AcademicYearRow } from "@/lib/academic-year";
import {
  saveAcademicYear,
  setYearArchived,
  setCurrentYear,
  deleteAcademicYear,
  startNewYear,
} from "./year-actions";

export function YearsManager({ years }: { years: AcademicYearRow[] }) {
  const t = useTranslations("years");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<AcademicYearRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [rollover, setRollover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (res.ok) router.refresh();
      else setError(res.error ?? "invalid");
    });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="gap-1" onClick={() => setRollover(true)}>
          <CalendarPlus className="size-4" />
          {t("startNewYear")}
        </Button>
        <Button size="sm" variant="secondary" className="gap-1" onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          {t("addYear")}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{t(`errors.${error}`)}</p>}

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tc("name")}</TableHead>
              <TableHead>{tc("period")}</TableHead>
              <TableHead className="text-end">{t("records")}</TableHead>
              <TableHead>{tc("status")}</TableHead>
              <TableHead className="text-end">{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {years.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {years.map((y) => {
              const total =
                y.counts.sessions + y.counts.payments + y.counts.payouts + y.counts.expenses;
              return (
                <TableRow key={y.id}>
                  <TableCell className="font-medium">
                    {locale === "ar" ? y.nameAr : y.nameEn}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <span dir="ltr">
                      {y.startDate} → {y.endDate}
                    </span>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    <span title={t("recordsBreakdown", { ...y.counts })}>{total}</span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {y.isCurrent && <Badge variant="success">{t("current")}</Badge>}
                      {y.archived && <Badge variant="warning">{t("archived")}</Badge>}
                      {!y.isCurrent && !y.archived && (
                        <Badge variant="muted">{t("open")}</Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-1">
                      {!y.archived && !y.isCurrent && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("makeCurrent")}
                          title={t("makeCurrent")}
                          disabled={pending}
                          onClick={() => run(() => setCurrentYear(locale, y.id))}
                        >
                          <Star className="size-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={y.archived ? t("unarchive") : t("archive")}
                        title={y.archived ? t("unarchive") : t("archive")}
                        disabled={pending || (!y.archived && y.isCurrent)}
                        onClick={() => run(() => setYearArchived(locale, y.id, !y.archived))}
                      >
                        {y.archived ? (
                          <ArchiveRestore className="size-4" />
                        ) : (
                          <Archive className="size-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tc("edit")}
                        disabled={pending}
                        onClick={() => setEditing(y)}
                      >
                        <Plus className="size-4 rotate-45" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tc("delete")}
                        disabled={pending || y.archived}
                        onClick={() => run(() => deleteAcademicYear(locale, y.id))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {(adding || editing) && (
        <YearDialog
          year={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {rollover && (
        <RolloverDialog
          current={years.find((y) => y.isCurrent) ?? null}
          onClose={() => setRollover(false)}
          onSaved={() => {
            setRollover(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function YearDialog({
  year,
  onClose,
  onSaved,
}: {
  year: AcademicYearRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("years");
  const tc = useTranslations("common");
  const locale = useLocale();

  const [nameAr, setNameAr] = useState(year?.nameAr ?? "");
  const [nameEn, setNameEn] = useState(year?.nameEn ?? "");
  const [startDate, setStartDate] = useState(year?.startDate ?? "");
  const [endDate, setEndDate] = useState(year?.endDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const res = await saveAcademicYear(locale, {
        id: year?.id ?? null,
        nameAr,
        nameEn,
        startDate,
        endDate,
      });
      if (res.ok) onSaved();
      else setError(res.error ?? "invalid");
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{year ? t("editYear") : t("addYear")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("nameAr")} htmlFor="y-ar">
              <Input id="y-ar" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </FormField>
            <FormField label={t("nameEn")} htmlFor="y-en">
              <Input id="y-en" dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("startDate")} htmlFor="y-start">
              <Input
                id="y-start"
                type="date"
                dir="ltr"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </FormField>
            <FormField label={t("endDate")} htmlFor="y-end">
              <Input
                id="y-end"
                type="date"
                dir="ltr"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </FormField>
          </div>
          {error && <p className="text-sm text-destructive">{t(`errors.${error}`)}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("cancel")}</Button>
          </DialogClose>
          <Button
            type="button"
            disabled={pending || !nameAr.trim() || !startDate || !endDate}
            onClick={submit}
          >
            {pending ? tc("saving") : tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Create next year, make it current, and archive the outgoing one in one step. */
function RolloverDialog({
  current,
  onClose,
  onSaved,
}: {
  current: AcademicYearRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("years");
  const tc = useTranslations("common");
  const locale = useLocale();

  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [archivePrevious, setArchivePrevious] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const frozenCount = current
    ? current.counts.sessions +
      current.counts.payments +
      current.counts.payouts +
      current.counts.expenses
    : 0;

  function submit() {
    setError(null);
    start(async () => {
      const res = await startNewYear(locale, {
        nameAr,
        nameEn,
        startDate,
        endDate,
        archivePrevious,
      });
      if (res.ok) onSaved();
      else setError(res.error ?? "invalid");
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("startNewYear")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("rolloverHint")}</p>

          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("nameAr")} htmlFor="r-ar">
              <Input id="r-ar" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </FormField>
            <FormField label={t("nameEn")} htmlFor="r-en">
              <Input id="r-en" dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("startDate")} htmlFor="r-start">
              <Input
                id="r-start"
                type="date"
                dir="ltr"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </FormField>
            <FormField label={t("endDate")} htmlFor="r-end">
              <Input
                id="r-end"
                type="date"
                dir="ltr"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </FormField>
          </div>

          {current && (
            <label className="flex items-start gap-2 rounded-md border border-warning bg-warning/10 p-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--primary)]"
                checked={archivePrevious}
                onChange={(e) => setArchivePrevious(e.target.checked)}
              />
              <span>
                {t("archivePrevious", {
                  name: locale === "ar" ? current.nameAr : current.nameEn,
                })}
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t("archiveWarning", { n: frozenCount })}
                </span>
              </span>
            </label>
          )}

          {error && <p className="text-sm text-destructive">{t(`errors.${error}`)}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("cancel")}</Button>
          </DialogClose>
          <Button
            type="button"
            disabled={pending || !nameAr.trim() || !startDate || !endDate}
            onClick={submit}
          >
            {pending ? tc("saving") : t("startNewYear")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
