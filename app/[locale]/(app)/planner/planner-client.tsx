"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Check,
  CheckCheck,
  Pencil,
  Trash2,
  Home,
  Building2,
  Settings2,
  AlignStartVertical,
} from "lucide-react";
import { useRouter, usePathname } from "@/i18n/navigation";
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
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { suggestNextStart, minToHHMM } from "@/lib/planner";
import type { PriceMatrix } from "../sessions/session-dialog";
import { deleteSession } from "../sessions/actions";
import {
  createDraftSession,
  updateDraft,
  confirmSession,
  confirmDay,
  compactTeacherDay,
  savePlannerSettings,
} from "./actions";

export type PlannerSession = {
  id: string;
  teacherId: string;
  startMin: number;
  hours: number;
  studentName: string;
  levelLabel: string;
  location: "CENTER" | "HOME";
  status: string;
  total: number;
};

type Opt = { id: string; label: string };
type StudentOpt = { id: string; name: string; gradeLevelId: string | null };

const CELL_STYLES: Record<string, string> = {
  DRAFT: "border-warning border-dashed bg-warning/10",
  SCHEDULED: "border-primary/40 bg-primary/5",
  CHECKED_IN: "border-warning bg-warning/15",
  COMPLETED: "border-[var(--success)]/50 bg-success/10",
  NO_SHOW: "border-destructive/50 bg-destructive/10",
  CANCELLED: "border-border bg-muted text-muted-foreground line-through",
};

function addDaysStr(s: string, n: number) {
  const d = new Date(`${s}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function PlannerClient({
  day,
  sessions,
  teachers,
  students,
  levels,
  matrix,
  currency,
  dayStartMin,
  homeGapMin,
}: {
  day: string;
  sessions: PlannerSession[];
  teachers: Opt[];
  students: StudentOpt[];
  levels: Opt[];
  matrix: PriceMatrix;
  currency: string;
  dayStartMin: number;
  homeGapMin: number;
}) {
  const t = useTranslations("planner");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const [pending, start] = useTransition();
  const [addFor, setAddFor] = useState<string | null>(null); // teacherId
  const [editing, setEditing] = useState<PlannerSession | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Group + sort each teacher's day.
  const byTeacher = useMemo(() => {
    const m = new Map<string, PlannerSession[]>();
    for (const tt of teachers) m.set(tt.id, []);
    for (const s of sessions) {
      if (!m.has(s.teacherId)) m.set(s.teacherId, []);
      m.get(s.teacherId)!.push(s);
    }
    for (const list of m.values()) list.sort((a, b) => a.startMin - b.startMin);
    return m;
  }, [sessions, teachers]);

  const maxSlots = Math.max(1, ...teachers.map((tt) => byTeacher.get(tt.id)?.length ?? 0));
  const slotCount = maxSlots + 1; // always one open slot — unlimited, unlike the paper's 10

  const drafts = sessions.filter((s) => s.status === "DRAFT");
  const confirmed = sessions.filter((s) => s.status === "COMPLETED");
  const expectedTotal = sessions
    .filter((s) => s.status !== "CANCELLED")
    .reduce((sum, s) => sum + s.total, 0);

  const today = new Date().toISOString().slice(0, 10);
  const go = (date: string) => router.push(`${pathname}?date=${date}`);
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
        <Button variant="secondary" size="sm" onClick={() => go(today)}>
          {t("today")}
        </Button>
        <div className="flex items-center">
          <Button variant="ghost" size="icon" aria-label={t("prev")} onClick={() => go(addDaysStr(day, -1))}>
            <ChevronRight className="size-4 rtl:hidden" />
            <ChevronLeft className="hidden size-4 rtl:block" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t("next")} onClick={() => go(addDaysStr(day, 1))}>
            <ChevronLeft className="size-4 rtl:hidden" />
            <ChevronRight className="hidden size-4 rtl:block" />
          </Button>
        </div>
        <Input
          type="date"
          dir="ltr"
          value={day}
          onChange={(e) => e.target.value && go(e.target.value)}
          className="w-40"
        />

        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Badge variant="warning">{t("draftCount", { n: drafts.length })}</Badge>
          <Badge variant="success">{t("confirmedCount", { n: confirmed.length })}</Badge>
          <Badge variant="default">
            {t("expectedTotal")}: {formatMoney(expectedTotal)} {currency}
          </Badge>
          <Button
            size="sm"
            className="gap-1"
            disabled={pending || drafts.length === 0}
            onClick={() => run(() => confirmDay(locale, { date: day }))}
          >
            <CheckCheck className="size-4" />
            {t("confirmDay")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("settings")}
            onClick={() => setShowSettings(true)}
          >
            <Settings2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
        {(["DRAFT", "COMPLETED", "SCHEDULED", "CANCELLED"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-block size-3 rounded-sm border", CELL_STYLES[s])} />
            {te(`sessionStatus.${s}`)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <Home className="size-3" /> {te("location.HOME")}
        </span>
      </div>

      {/* Planner grid (paper layout: teacher rows × numbered slots) */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="sticky start-0 z-10 w-44 bg-muted p-2 text-start">{t("teacher")}</th>
              {Array.from({ length: slotCount }, (_, i) => (
                <th key={i} className="min-w-40 border-s border-border p-2 text-center tabular-nums">
                  {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teachers.map((teacher) => {
              const list = byTeacher.get(teacher.id) ?? [];
              const teacherDrafts = list.filter((s) => s.status === "DRAFT");
              return (
                <tr key={teacher.id} className="border-b border-border/60 align-top">
                  {/* Teacher cell (like المدرس/ة on the paper) */}
                  <td className="sticky start-0 z-10 bg-card p-2">
                    <div className="font-semibold">{teacher.label}</div>
                    <div className="mt-1 flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t("confirmTeacher")}
                        title={t("confirmTeacher")}
                        disabled={pending || teacherDrafts.length === 0}
                        onClick={() => run(() => confirmDay(locale, { date: day, teacherId: teacher.id }))}
                      >
                        <CheckCheck className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t("compact")}
                        title={t("compact")}
                        disabled={pending || teacherDrafts.length === 0}
                        onClick={() => run(() => compactTeacherDay(locale, { date: day, teacherId: teacher.id }))}
                      >
                        <AlignStartVertical className="size-4" />
                      </Button>
                    </div>
                  </td>

                  {Array.from({ length: slotCount }, (_, i) => {
                    const s = list[i];
                    if (!s) {
                      // First empty slot gets the add button; later ones stay blank.
                      const isNext = i === list.length;
                      return (
                        <td key={i} className="border-s border-border/60 p-1.5">
                          {isNext && (
                            <button
                              onClick={() => setAddFor(teacher.id)}
                              className="flex h-full min-h-16 w-full items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                              aria-label={t("addToSlot")}
                            >
                              <Plus className="size-4" />
                            </button>
                          )}
                        </td>
                      );
                    }
                    const end = s.startMin + s.hours * 60;
                    return (
                      <td key={s.id} className="border-s border-border/60 p-1.5">
                        <div className={cn("group rounded-md border p-2", CELL_STYLES[s.status] ?? "")}>
                          <div className="flex items-center justify-between gap-1 tabular-nums" dir="ltr">
                            <span className="font-semibold">
                              {minToHHMM(s.startMin)}–{minToHHMM(end)}
                            </span>
                            {s.location === "HOME" ? (
                              <Home className="size-3.5 shrink-0" />
                            ) : (
                              <Building2 className="size-3.5 shrink-0 opacity-50" />
                            )}
                          </div>
                          <div className="truncate font-medium">{s.studentName}</div>
                          <div className="flex items-center justify-between text-xs opacity-80">
                            <span>{s.levelLabel}</span>
                            <span className="tabular-nums">{formatMoney(s.total)}</span>
                          </div>
                          {s.status === "DRAFT" && (
                            <div className="mt-1 flex justify-end gap-0.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                aria-label={t("confirm")}
                                title={t("confirm")}
                                disabled={pending}
                                onClick={() => run(() => confirmSession(locale, s.id))}
                              >
                                <Check className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                aria-label={tc("edit")}
                                disabled={pending}
                                onClick={() => setEditing(s)}
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                aria-label={tc("delete")}
                                disabled={pending}
                                onClick={() => run(() => deleteSession(locale, s.id))}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add-draft dialog */}
      {addFor && (
        <AddDraftDialog
          day={day}
          teacherId={addFor}
          teacherName={teachers.find((x) => x.id === addFor)?.label ?? ""}
          existing={byTeacher.get(addFor) ?? []}
          students={students}
          levels={levels}
          matrix={matrix}
          currency={currency}
          dayStartMin={dayStartMin}
          homeGapMin={homeGapMin}
          onClose={() => setAddFor(null)}
          onSaved={() => {
            setAddFor(null);
            router.refresh();
          }}
        />
      )}

      {/* Edit-draft dialog */}
      {editing && (
        <EditDraftDialog
          session={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {/* Planner settings */}
      {showSettings && (
        <SettingsDialog
          dayStartMin={dayStartMin}
          homeGapMin={homeGapMin}
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            setShowSettings(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ---------- dialogs ---------- */

function AddDraftDialog({
  day,
  teacherId,
  teacherName,
  existing,
  students,
  levels,
  matrix,
  currency,
  dayStartMin,
  homeGapMin,
  onClose,
  onSaved,
}: {
  day: string;
  teacherId: string;
  teacherName: string;
  existing: PlannerSession[];
  students: StudentOpt[];
  levels: Opt[];
  matrix: PriceMatrix;
  currency: string;
  dayStartMin: number;
  homeGapMin: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("planner");
  const ts = useTranslations("sessions");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();

  const [studentId, setStudentId] = useState("");
  const [gradeLevelId, setGradeLevelId] = useState("");
  const [location, setLocation] = useState<"CENTER" | "HOME">("CENTER");
  const [hours, setHours] = useState("1");
  const [time, setTime] = useState(() =>
    minToHHMM(
      suggestNextStart({
        existing: existing.map((s) => ({ startMin: s.startMin, hours: s.hours })),
        dayStartMin,
        homeGapMin,
        nextLocation: "CENTER",
      }),
    ),
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Re-suggest when switching to HOME (adds the travel gap).
  function onLocationChange(loc: "CENTER" | "HOME") {
    setLocation(loc);
    setTime(
      minToHHMM(
        suggestNextStart({
          existing: existing.map((s) => ({ startMin: s.startMin, hours: s.hours })),
          dayStartMin,
          homeGapMin,
          nextLocation: loc,
        }),
      ),
    );
  }

  const pricePerHour = (() => {
    const row = matrix[gradeLevelId];
    return row ? (row[location] ?? 0) : 0;
  })();
  const total = pricePerHour * (parseFloat(hours) || 0);

  function submit() {
    setError(null);
    if (!studentId || !gradeLevelId) return setError("required");
    start(async () => {
      const res = await createDraftSession(locale, {
        date: day,
        time,
        teacherId,
        studentId,
        gradeLevelId,
        location,
        hours: parseFloat(hours) || 1,
      });
      if (res.ok) onSaved();
      else setError(res.error ?? "invalid");
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addDraftFor", { teacher: teacherName })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label={ts("student")} htmlFor="p-student">
            <Select
              id="p-student"
              value={studentId}
              onChange={(e) => {
                setStudentId(e.target.value);
                const st = students.find((x) => x.id === e.target.value);
                if (st?.gradeLevelId) setGradeLevelId(st.gradeLevelId);
              }}
            >
              <option value="">—</option>
              {students.map((st) => (
                <option key={st.id} value={st.id}>{st.name}</option>
              ))}
            </Select>
          </FormField>

          <div className="grid grid-cols-3 gap-3">
            <FormField label={ts("startTime")} htmlFor="p-time">
              <Input id="p-time" type="time" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} />
            </FormField>
            <FormField label={ts("hours")} htmlFor="p-hours">
              <Input
                id="p-hours"
                type="number"
                step="0.5"
                min="0.5"
                dir="ltr"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </FormField>
            <FormField label={ts("location")} htmlFor="p-loc">
              <Select
                id="p-loc"
                value={location}
                onChange={(e) => onLocationChange(e.target.value as "CENTER" | "HOME")}
              >
                <option value="CENTER">{te("location.CENTER")}</option>
                <option value="HOME">{te("location.HOME")}</option>
              </Select>
            </FormField>
          </div>

          <FormField label={ts("gradeLevel")} htmlFor="p-grade">
            <Select id="p-grade" value={gradeLevelId} onChange={(e) => setGradeLevelId(e.target.value)}>
              <option value="">—</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </Select>
          </FormField>

          <div className="flex items-center justify-between rounded-md bg-accent/60 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              {ts("pricePerHour")}: <span className="font-medium tabular-nums text-foreground">{formatMoney(pricePerHour)}</span> {currency}
            </span>
            <span className="font-semibold">
              {ts("total")}: <span className="tabular-nums">{formatMoney(total)}</span> {currency}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{t("timeAutoHint")}</p>

          {error && <p className="text-sm text-destructive">{tc("required")}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("cancel")}</Button>
          </DialogClose>
          <Button type="button" disabled={pending || !studentId || !gradeLevelId} onClick={submit}>
            {pending ? tc("saving") : t("addDraft")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDraftDialog({
  session,
  onClose,
  onSaved,
}: {
  session: PlannerSession;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("planner");
  const ts = useTranslations("sessions");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();

  const [time, setTime] = useState(minToHHMM(session.startMin));
  const [hours, setHours] = useState(String(session.hours));
  const [location, setLocation] = useState<"CENTER" | "HOME">(session.location);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const res = await updateDraft(locale, {
        id: session.id,
        time,
        hours: parseFloat(hours) || session.hours,
        location,
      });
      if (res.ok) onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editDraft", { student: session.studentName })}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <FormField label={ts("startTime")} htmlFor="e-time">
            <Input id="e-time" type="time" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} />
          </FormField>
          <FormField label={ts("hours")} htmlFor="e-hours">
            <Input
              id="e-hours"
              type="number"
              step="0.5"
              min="0.5"
              dir="ltr"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </FormField>
          <FormField label={ts("location")} htmlFor="e-loc">
            <Select id="e-loc" value={location} onChange={(e) => setLocation(e.target.value as "CENTER" | "HOME")}>
              <option value="CENTER">{te("location.CENTER")}</option>
              <option value="HOME">{te("location.HOME")}</option>
            </Select>
          </FormField>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("cancel")}</Button>
          </DialogClose>
          <Button type="button" disabled={pending} onClick={submit}>
            {pending ? tc("saving") : tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({
  dayStartMin,
  homeGapMin,
  onClose,
  onSaved,
}: {
  dayStartMin: number;
  homeGapMin: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("planner");
  const tc = useTranslations("common");
  const locale = useLocale();

  const [dayStart, setDayStart] = useState(minToHHMM(dayStartMin));
  const [gap, setGap] = useState(String(homeGapMin));
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const res = await savePlannerSettings(locale, {
        dayStart,
        homeGapMin: parseInt(gap, 10) || 0,
      });
      if (res.ok) onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings")}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("dayStart")} htmlFor="s-start">
            <Input id="s-start" type="time" dir="ltr" value={dayStart} onChange={(e) => setDayStart(e.target.value)} />
          </FormField>
          <FormField label={t("homeGap")} htmlFor="s-gap">
            <Input id="s-gap" type="number" min="0" max="180" dir="ltr" value={gap} onChange={(e) => setGap(e.target.value)} />
          </FormField>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("settingsHint")}</p>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("cancel")}</Button>
          </DialogClose>
          <Button type="button" disabled={pending} onClick={submit}>
            {pending ? tc("saving") : tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
