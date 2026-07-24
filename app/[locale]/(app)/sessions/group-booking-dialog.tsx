"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Users, X, Check, Repeat, AlertTriangle, Wand2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { localNowTime, localToday } from "@/lib/session-time";
import { formatMoney } from "@/lib/money";
import { weeklyOccurrences } from "@/lib/recurrence";
import { useConflictCheck } from "@/components/conflict-warnings";
import { createGroupSessions } from "./actions";
import { suggestFix, type FixSuggestion } from "./suggest-actions";
import type { StudentOpt, Opt, PriceMatrix } from "./session-dialog";

export function GroupBookingDialog({
  trigger,
  students,
  teachers,
  levels,
  matrix,
  currency,
  defaultDate,
  defaultTime,
  defaultTeacherId,
  open: openProp,
  onOpenChange,
  onSaved,
}: {
  trigger?: ReactNode;
  students: StudentOpt[];
  teachers: Opt[];
  levels: Opt[];
  matrix: PriceMatrix;
  currency: string;
  defaultDate?: string;
  defaultTime?: string;
  defaultTeacherId?: string;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  onSaved?: () => void;
}) {
  const t = useTranslations("group");
  const ts = useTranslations("sessions");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const tf = useTranslations("conflicts");
  const locale = useLocale();

  const controlled = openProp !== undefined;
  const [openState, setOpenState] = useState(false);
  const open = controlled ? openProp! : openState;
  const setOpen = (v: boolean) => {
    if (!controlled) setOpenState(v);
    onOpenChange?.(v);
  };

  const today = localToday();
  const [teacherId, setTeacherId] = useState(defaultTeacherId ?? "");
  const [date, setDate] = useState(defaultDate ?? today);
  const [time, setTime] = useState(defaultTime ?? localNowTime());
  const [hours, setHours] = useState("1");
  const [location, setLocation] = useState<"CENTER" | "HOME">("CENTER");
  const [gradeOverride, setGradeOverride] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("UNPAID");
  const [q, setQ] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Weekly recurrence
  const [repeat, setRepeat] = useState(false);
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set());
  const [weeks, setWeeks] = useState("4");

  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return students.filter(
      (x) =>
        (!gradeFilter || x.gradeLevelId === gradeFilter) &&
        (!s || x.name.toLowerCase().includes(s)),
    );
  }, [students, q, gradeFilter]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function selectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((s) => next.add(s.id));
      return next;
    });
  }

  const priceForStudent = (s: StudentOpt) => {
    const grade = gradeOverride || s.gradeLevelId || "";
    const row = grade ? matrix[grade] : undefined;
    return row ? (row[location] ?? 0) : 0;
  };

  // Gulf-ordered weekdays (Sat → Fri) with localized short labels.
  const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];
  const weekdayLabel = (dn: number) =>
    new Date(Date.UTC(2023, 0, 1 + dn)).toLocaleDateString(locale === "ar" ? "ar-EG" : "en-US", {
      weekday: "short",
      timeZone: "UTC",
    });

  // Expand the recurrence into concrete occurrence dates (YYYY-MM-DD).
  const occurrences = useMemo(() => {
    if (!repeat) return [date];
    return weeklyOccurrences(date, [...weekdays], parseInt(weeks) || 1);
  }, [repeat, date, weekdays, weeks]);

  const { estTotal, noGradeCount } = useMemo(() => {
    let perOccurrence = 0;
    let noGrade = 0;
    const h = parseFloat(hours) || 0;
    for (const s of students) {
      if (!selected.has(s.id)) continue;
      const grade = gradeOverride || s.gradeLevelId || "";
      if (!grade) noGrade++;
      perOccurrence += priceForStudent(s) * h;
    }
    return { estTotal: perOccurrence * occurrences.length, noGradeCount: noGrade };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, selected, gradeOverride, location, hours, matrix, occurrences]);

  const totalSessions = selected.size * occurrences.length;

  // Advisory check against the FIRST occurrence only — checking every date in a
  // long recurrence would be a lot of queries for a warning the user reads once.
  const conflictResults = useConflictCheck(
    {
      date: occurrences[0] ?? date,
      time,
      hours: parseFloat(hours) || 1,
      teacherId,
      studentIds: [...selected],
    },
    open,
  );
  const conflictedStudents = conflictResults.filter((r) => r.conflicts.length > 0);
  const conflictByStudent = new Map(conflictResults.map((r) => [r.studentId, r.conflicts.length]));

  // A proposed way out of the clash — recomputed server-side whenever the slot
  // or the selection changes, only while there is a clash to fix.
  const [fix, setFix] = useState<FixSuggestion | null>(null);
  const [fixLoading, setFixLoading] = useState(false);
  const hasConflict = conflictedStudents.length > 0;
  const fixKey = [occurrences[0] ?? date, time, hours, teacherId, [...selected].sort().join(",")].join("|");
  useEffect(() => {
    if (!open || !hasConflict || !teacherId || selected.size === 0) {
      setFix(null);
      setFixLoading(false);
      return;
    }
    let cancelled = false;
    setFixLoading(true);
    const handle = setTimeout(async () => {
      const r = await suggestFix({
        date: occurrences[0] ?? date,
        time,
        hours: parseFloat(hours) || 1,
        teacherId,
        studentIds: [...selected],
      });
      if (!cancelled) {
        setFix(r);
        setFixLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // fixKey collapses the inputs into one stable dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixKey, open, hasConflict]);

  function toggleWeekday(dn: number) {
    setWeekdays((prev) => {
      const next = new Set(prev);
      next.has(dn) ? next.delete(dn) : next.add(dn);
      return next;
    });
  }

  function submit() {
    setError(null);
    setResult(null);
    if (!teacherId) return setError("teacher");
    if (selected.size === 0) return setError("students");
    start(async () => {
      const res = await createGroupSessions(locale, {
        dates: occurrences,
        time,
        teacherId,
        location,
        hours: parseFloat(hours) || 0,
        gradeLevelId: gradeOverride || null,
        paymentStatus: paymentStatus as "UNPAID" | "PARTIAL" | "PAID",
        studentIds: [...selected],
      });
      if (res.ok) {
        setResult({ created: res.created ?? 0, skipped: res.skipped ?? 0 });
        setSelected(new Set());
        onSaved?.();
      } else {
        setError(res.error ?? "invalid");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setResult(null); setError(null); } }}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <FormField label={ts("teacher")} htmlFor="g-teacher">
            <Select id="g-teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)} required>
              <option value="">—</option>
              {teachers.map((tt) => (
                <option key={tt.id} value={tt.id}>{tt.label}</option>
              ))}
            </Select>
          </FormField>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <FormField label={tc("date")} htmlFor="g-date">
              <Input id="g-date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormField>
            <FormField label={ts("startTime")} htmlFor="g-time">
              <Input id="g-time" type="time" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} />
            </FormField>
            <FormField label={ts("hours")} htmlFor="g-hours">
              <Input id="g-hours" type="number" step="0.5" min="0.5" dir="ltr" value={hours} onChange={(e) => setHours(e.target.value)} />
            </FormField>
            <FormField label={ts("location")} htmlFor="g-loc">
              <Select id="g-loc" value={location} onChange={(e) => setLocation(e.target.value as "CENTER" | "HOME")}>
                <option value="CENTER">{te("location.CENTER")}</option>
                <option value="HOME">{te("location.HOME")}</option>
              </Select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("gradeOverride")} htmlFor="g-grade">
              <Select id="g-grade" value={gradeOverride} onChange={(e) => setGradeOverride(e.target.value)}>
                <option value="">{t("perStudentGrade")}</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </Select>
            </FormField>
            <FormField label={ts("paymentStatus")} htmlFor="g-pay">
              <Select id="g-pay" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
                <option value="UNPAID">{te("paymentStatus.UNPAID")}</option>
                <option value="PARTIAL">{te("paymentStatus.PARTIAL")}</option>
                <option value="PAID">{te("paymentStatus.PAID")}</option>
              </Select>
            </FormField>
          </div>

          {/* Weekly recurrence */}
          <div className="rounded-md border border-border p-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={repeat}
                onChange={(e) => setRepeat(e.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              <Repeat className="size-4 text-muted-foreground" />
              {t("repeatWeekly")}
            </label>
            {repeat && (
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <div className="flex flex-wrap gap-1">
                  {WEEK_ORDER.map((dn) => {
                    const on = weekdays.has(dn);
                    return (
                      <button
                        key={dn}
                        type="button"
                        onClick={() => toggleWeekday(dn)}
                        className={cn(
                          "rounded-md border px-2 py-1 text-xs",
                          on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent",
                        )}
                      >
                        {weekdayLabel(dn)}
                      </button>
                    );
                  })}
                </div>
                <div className="w-24">
                  <label className="text-xs text-muted-foreground">{t("weeks")}</label>
                  <Input type="number" min="1" max="52" dir="ltr" value={weeks} onChange={(e) => setWeeks(e.target.value)} className="h-8" />
                </div>
                <span className="text-xs text-muted-foreground">{t("occurrences", { n: occurrences.length })}</span>
              </div>
            )}
          </div>

          {/* Student multi-select */}
          <div className="rounded-md border border-border">
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
              <Users className="size-4 text-muted-foreground" />
              <Input placeholder={t("searchStudents")} value={q} onChange={(e) => setQ(e.target.value)} className="h-8 min-w-32 flex-1" />
              {/* Filter the list to one grade, so "get four in grade 10" is a
                  single selection instead of hunting names one by one. */}
              <Select
                aria-label={t("filterByGrade")}
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value)}
                className="h-8 w-36"
              >
                <option value="">{t("allGrades")}</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </Select>
              <Button type="button" size="sm" variant="secondary" onClick={selectAllFiltered}>{t("selectAll")}</Button>
              {selected.size > 0 && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="gap-1">
                  <X className="size-3.5" /> {t("clear")}
                </Button>
              )}
            </div>
            <div className="max-h-52 overflow-y-auto p-1">
              {filtered.length === 0 && (
                <p className="p-3 text-center text-sm text-muted-foreground">{tc("noData")}</p>
              )}
              <div className="grid grid-cols-2 gap-0.5 sm:grid-cols-3">
                {filtered.map((s) => {
                  const on = selected.has(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggle(s.id)}
                      className={cn(
                        "flex items-center gap-2 rounded px-2 py-1.5 text-start text-sm transition-colors",
                        on ? "bg-primary/10 text-foreground" : "hover:bg-accent",
                      )}
                    >
                      <span className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                      )}>
                        {on && <Check className="size-3" />}
                      </span>
                      <span className="truncate">{s.name}</span>
                      {on && (conflictByStudent.get(s.id) ?? 0) > 0 && (
                        <AlertTriangle className="ms-auto size-3.5 shrink-0 text-warning" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-accent/60 px-3 py-2 text-sm">
            <span className="font-medium">
              {t("selectedCount", { n: selected.size })}
              {repeat && <> · {t("totalSessions", { n: totalSessions })}</>}
            </span>
            <span className="font-semibold">
              {ts("total")}: <span className="tabular-nums">{formatMoney(estTotal)}</span> {currency}
            </span>
          </div>
          {noGradeCount > 0 && (
            <p className="text-xs text-warning">{t("noGradeWarn", { n: noGradeCount })}</p>
          )}
          {conflictedStudents.length > 0 && (
            <div className="rounded-md border border-warning bg-warning/10 p-2.5 text-sm">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-4 shrink-0" />
                {tf("countForStudents", { n: conflictedStudents.length })}
              </div>
              <ul className="ms-5 list-disc space-y-0.5 text-xs">
                {conflictedStudents.slice(0, 5).map((r) => (
                  <li key={r.studentId}>
                    {students.find((s) => s.id === r.studentId)?.name ?? r.studentId}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-muted-foreground">{tf("advisory")}</p>

              {/* Suggest a fix, accept with one tap. Accepting sets the field,
                  the conflict check re-runs, and the panel clears if it worked. */}
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-warning/40 pt-2">
                {fixLoading ? (
                  <span className="text-xs text-muted-foreground">{tf("findingFix")}</span>
                ) : fix && (fix.time || fix.teacherId) ? (
                  <>
                    <span className="text-xs font-medium">{tf("suggestFix")}</span>
                    {fix.time && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 gap-1"
                        onClick={() => setTime(fix.time!)}
                      >
                        <Wand2 className="size-3.5" />
                        {tf("moveTo", { time: fix.time })}
                      </Button>
                    )}
                    {fix.teacherId && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 gap-1"
                        onClick={() => setTeacherId(fix.teacherId!)}
                      >
                        <Wand2 className="size-3.5" />
                        {tf("assignTeacher", {
                          name: teachers.find((tt) => tt.id === fix.teacherId)?.label ?? "",
                        })}
                      </Button>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">{tf("noAutoFix")}</span>
                )}
              </div>
            </div>
          )}

          {result && (
            <p className="rounded-md bg-success/15 px-3 py-2 text-sm text-success">
              {t("created", { n: result.created })}
              {result.skipped > 0 ? ` · ${t("skipped", { n: result.skipped })}` : ""}
            </p>
          )}
          {error && (
            <p className="text-sm text-destructive">
              {error === "teacher"
                ? t("pickTeacher")
                : error === "students"
                  ? t("pickStudents")
                  : error === "tooMany"
                    ? t("tooMany")
                    : tc("required")}
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("cancel")}</Button>
          </DialogClose>
          <Button type="button" disabled={pending || selected.size === 0} onClick={submit} className="gap-1">
            <Users className="size-4" />
            {pending ? tc("saving") : t("book", { n: totalSessions })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
