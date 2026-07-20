"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
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
  AlertTriangle,
  CalendarPlus,
  Copy as CopyIcon,
  LayoutTemplate,
  Printer,
  MapPin,
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
import { Combobox } from "@/components/ui/combobox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import { suggestNextStart, minToHHMM, hhmmToMin } from "@/lib/planner";
import { findConflicts, weekdayOf, WEEKDAY_ORDER, type Conflict } from "@/lib/conflicts";
import { ConflictWarnings } from "@/components/conflict-warnings";
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
import {
  generateDayFromTemplates,
  copyLastWeek,
  saveTemplate,
  deleteTemplate,
  type TemplateState,
} from "./template-actions";

export type PlannerSession = {
  id: string;
  teacherId: string;
  studentId: string;
  startMin: number;
  hours: number;
  studentName: string;
  levelLabel: string;
  location: "CENTER" | "HOME";
  status: string;
  total: number;
  /** Student's home location code — only meaningful for HOME sessions. */
  homeCode: string | null;
  /** Free trial lesson booked from the leads board. */
  isTrial: boolean;
};

export type PlannerTemplateRow = {
  id: string;
  teacherId: string;
  studentId: string;
  weekday: number;
  startMin: number;
  hours: number;
  location: "CENTER" | "HOME";
};

export type AvailabilityRow = {
  teacherId: string;
  weekday: number;
  startMin: number;
  endMin: number;
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

/**
 * Print the sheet in landscape.
 *
 * `@page { size: … }` only works at the top level of a stylesheet — it can't be
 * scoped by a class or a named page in any way browsers actually honour — so
 * the rule is injected for the duration of the print call and removed after.
 */
function printLandscape() {
  const style = document.createElement("style");
  style.media = "print";
  style.textContent = "@page { size: A4 landscape; margin: 8mm; }";
  document.head.appendChild(style);
  try {
    window.print();
  } finally {
    style.remove();
  }
}

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
  availability,
  templates,
  centerName,
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
  availability: AvailabilityRow[];
  templates: PlannerTemplateRow[];
  centerName: string;
}) {
  const t = useTranslations("planner");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const tf = useTranslations("conflicts");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const [pending, start] = useTransition();
  const [addFor, setAddFor] = useState<string | null>(null); // teacherId
  const [editing, setEditing] = useState<PlannerSession | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  // Drag-and-drop: draft card → any teacher row, then a time prompt on drop.
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverTeacher, setHoverTeacher] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<{
    session: PlannerSession;
    teacherId: string;
  } | null>(null);

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

  const weekday = weekdayOf(day);

  /**
   * Conflicts are computed in the browser: the planner already holds the whole
   * day plus every availability window, so no round-trip is needed.
   */
  const busy = useMemo(
    () =>
      sessions.map((s) => ({
        id: s.id,
        teacherId: s.teacherId,
        studentId: s.studentId,
        startMin: s.startMin,
        hours: s.hours,
        status: s.status,
        studentName: s.studentName,
        teacherName: teachers.find((x) => x.id === s.teacherId)?.label,
      })),
    [sessions, teachers],
  );

  const conflictsFor = useCallback(
    (c: {
      id?: string | null;
      teacherId: string;
      studentId: string;
      startMin: number;
      hours: number;
    }) =>
      findConflicts({
        candidate: { ...c, weekday },
        existing: busy,
        availability: availability.filter((a) => a.teacherId === c.teacherId),
      }),
    [busy, availability, weekday],
  );

  /** Cards that already clash get a warning marker in the grid. */
  const conflictedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sessions) {
      if (s.status === "CANCELLED" || s.status === "NO_SHOW") continue;
      if (conflictsFor(s).length > 0) ids.add(s.id);
    }
    return ids;
  }, [sessions, conflictsFor]);

  const dayTemplates = templates.filter((x) => x.weekday === weekday);
  const [banner, setBanner] = useState<string | null>(null);

  const runGenerate = (fn: () => Promise<TemplateState>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        const parts: string[] = [];
        if (res.count) parts.push(t("generated", { n: res.count }));
        if (res.skipped) parts.push(t("skippedExisting", { n: res.skipped }));
        // Nothing created AND nothing skipped means there was genuinely no
        // source to draw from — otherwise say what was skipped instead.
        setBanner(parts.length ? parts.join(" · ") : t("generatedNone"));
        router.refresh();
      }
    });

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
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
            variant="secondary"
            className="gap-1"
            disabled={pending || dayTemplates.length === 0}
            title={t("generateDay")}
            onClick={() => runGenerate(() => generateDayFromTemplates(locale, { date: day }))}
          >
            <CalendarPlus className="size-4" />
            {t("generateDayShort")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="gap-1"
            disabled={pending}
            onClick={() => runGenerate(() => copyLastWeek(locale, { date: day }))}
          >
            <CopyIcon className="size-4" />
            {t("copyLastWeek")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("templates")}
            title={t("templates")}
            onClick={() => setShowTemplates(true)}
          >
            <LayoutTemplate className="size-4" />
          </Button>
          <Button size="sm" variant="secondary" className="gap-1" onClick={printLandscape}>
            <Printer className="size-4" />
            {t("printSheet")}
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

      {banner && (
        <p className="rounded-md bg-accent px-3 py-2 text-sm" role="status">
          {banner}
        </p>
      )}

      {/* Legend */}
      <div className="no-print flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
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
      <div data-print="A4L" className="overflow-x-auto rounded-lg border border-border bg-card">
        {/* Print-only header — on screen the toolbar already says which day it is. */}
        <div className="hidden print:mb-2 print:block print:text-center">
          <div className="font-bold">{centerName || t("sheetTitle")}</div>
          <div className="text-xs">
            {t("sheetTitle")} · <span dir="ltr">{day}</span> · {te(`weekday.${weekday}`)}
          </div>
        </div>
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
                <tr
                  key={teacher.id}
                  className={cn(
                    "border-b border-border/60 align-top transition-colors",
                    dragId && hoverTeacher === teacher.id && "bg-primary/5",
                  )}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (hoverTeacher !== teacher.id) setHoverTeacher(teacher.id);
                  }}
                  onDragLeave={() =>
                    setHoverTeacher((h) => (h === teacher.id ? null : h))
                  }
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!dragId) return;
                    const s = sessions.find((x) => x.id === dragId);
                    setDragId(null);
                    setHoverTeacher(null);
                    if (s) setMoveTarget({ session: s, teacherId: teacher.id });
                  }}
                >
                  {/* Teacher cell (like المدرس/ة on the paper) */}
                  <td className="sticky start-0 z-10 bg-card p-2">
                    <div className="font-semibold">{teacher.label}</div>
                    <div className="no-print mt-1 flex gap-1">
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
                              className="no-print flex h-full min-h-16 w-full items-center justify-center rounded-md border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
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
                        <div
                          draggable={s.status === "DRAFT"}
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", s.id);
                            setDragId(s.id);
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setHoverTeacher(null);
                          }}
                          className={cn(
                            "group rounded-md border p-2",
                            CELL_STYLES[s.status] ?? "",
                            s.status === "DRAFT" && "cursor-grab active:cursor-grabbing",
                            dragId === s.id && "opacity-40 ring-2 ring-ring",
                          )}
                        >
                          <div className="flex items-center justify-between gap-1 tabular-nums" dir="ltr">
                            <span className="font-semibold">
                              {minToHHMM(s.startMin)}–{minToHHMM(end)}
                            </span>
                            <span className="flex shrink-0 items-center gap-1">
                              {conflictedIds.has(s.id) && (
                                <AlertTriangle
                                  className="size-3.5 text-warning"
                                  aria-label={tf("title")}
                                />
                              )}
                              {s.location === "HOME" ? (
                                <Home className="size-3.5" />
                              ) : (
                                <Building2 className="size-3.5 opacity-50" />
                              )}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="truncate font-medium">{s.studentName}</span>
                            {s.isTrial && (
                              <Badge variant="success" className="shrink-0 px-1 py-0 text-[10px]">
                                {te("trial")}
                              </Badge>
                            )}
                          </div>
                          {/* Where the teacher is actually going — only home
                              visits need a location, and only if one is set. */}
                          {s.location === "HOME" && s.homeCode && (
                            <div
                              className="mt-0.5 flex items-center gap-1 text-xs font-medium"
                              title={t("homeCodeTitle")}
                            >
                              <MapPin className="size-3 shrink-0" />
                              <span className="truncate">{s.homeCode}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between text-xs opacity-80">
                            <span>{s.levelLabel}</span>
                            <span className="tabular-nums">{formatMoney(s.total)}</span>
                          </div>
                          {s.status === "DRAFT" && (
                            <div className="no-print mt-1 flex justify-end gap-0.5">
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
          conflictsFor={conflictsFor}
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
          teachers={teachers}
          conflictsFor={conflictsFor}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {/* Move dialog (after drag-and-drop): confirm target teacher + new time */}
      {moveTarget && (
        <MoveDialog
          session={moveTarget.session}
          targetTeacherId={moveTarget.teacherId}
          targetTeacherName={teachers.find((x) => x.id === moveTarget.teacherId)?.label ?? ""}
          targetExisting={(byTeacher.get(moveTarget.teacherId) ?? []).filter(
            (s) => s.id !== moveTarget.session.id,
          )}
          dayStartMin={dayStartMin}
          homeGapMin={homeGapMin}
          conflictsFor={conflictsFor}
          onClose={() => setMoveTarget(null)}
          onSaved={() => {
            setMoveTarget(null);
            router.refresh();
          }}
        />
      )}

      {/* Weekly templates manager */}
      {showTemplates && (
        <TemplatesDialog
          templates={templates}
          teachers={teachers}
          students={students}
          onClose={() => setShowTemplates(false)}
          onChanged={() => router.refresh()}
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

/** Resolves advisory conflicts for a candidate slot, computed client-side. */
type ConflictsFor = (c: {
  id?: string | null;
  teacherId: string;
  studentId: string;
  startMin: number;
  hours: number;
}) => Conflict[];

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
  conflictsFor,
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
  conflictsFor: ConflictsFor;
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

  const conflicts = studentId
    ? conflictsFor({
        teacherId,
        studentId,
        startMin: hhmmToMin(time, 0),
        hours: parseFloat(hours) || 1,
      })
    : [];

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
            <Combobox
              id="p-student"
              options={students.map((st) => ({ value: st.id, label: st.name }))}
              value={studentId}
              onChange={(v) => {
                setStudentId(v);
                const st = students.find((x) => x.id === v);
                if (st?.gradeLevelId) setGradeLevelId(st.gradeLevelId);
              }}
            />
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
          <ConflictWarnings conflicts={conflicts} />
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
  teachers,
  conflictsFor,
  onClose,
  onSaved,
}: {
  session: PlannerSession;
  teachers: Opt[];
  conflictsFor: ConflictsFor;
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
  const [teacherId, setTeacherId] = useState(session.teacherId);
  const [pending, start] = useTransition();

  const conflicts = conflictsFor({
    id: session.id,
    teacherId,
    studentId: session.studentId,
    startMin: hhmmToMin(time, session.startMin),
    hours: parseFloat(hours) || session.hours,
  });

  function submit() {
    start(async () => {
      const res = await updateDraft(locale, {
        id: session.id,
        time,
        hours: parseFloat(hours) || session.hours,
        location,
        teacherId: teacherId !== session.teacherId ? teacherId : null,
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
        <div className="space-y-3">
          <FormField label={ts("teacher")} htmlFor="e-teacher">
            <Select id="e-teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
              {teachers.map((tt) => (
                <option key={tt.id} value={tt.id}>{tt.label}</option>
              ))}
            </Select>
          </FormField>
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
          <ConflictWarnings conflicts={conflicts} />
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

/** Time-change prompt shown after dropping a dragged draft on a teacher row. */
function MoveDialog({
  session,
  targetTeacherId,
  targetTeacherName,
  targetExisting,
  dayStartMin,
  homeGapMin,
  conflictsFor,
  onClose,
  onSaved,
}: {
  session: PlannerSession;
  targetTeacherId: string;
  targetTeacherName: string;
  targetExisting: PlannerSession[];
  dayStartMin: number;
  homeGapMin: number;
  conflictsFor: ConflictsFor;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("planner");
  const ts = useTranslations("sessions");
  const tc = useTranslations("common");
  const locale = useLocale();

  const sameTeacher = targetTeacherId === session.teacherId;
  // Suggest the chained slot on the TARGET teacher's day (dragged card excluded).
  const suggested = minToHHMM(
    suggestNextStart({
      existing: targetExisting.map((s) => ({ startMin: s.startMin, hours: s.hours })),
      dayStartMin,
      homeGapMin,
      nextLocation: session.location,
    }),
  );
  const [time, setTime] = useState(suggested);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const res = await updateDraft(locale, {
        id: session.id,
        time,
        hours: session.hours,
        location: session.location,
        teacherId: sameTeacher ? null : targetTeacherId,
      });
      if (res.ok) onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {sameTeacher
              ? t("retimeTitle", { student: session.studentName })
              : t("moveTitle", { student: session.studentName, teacher: targetTeacherName })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("currentTime")}: <span className="tabular-nums" dir="ltr">{minToHHMM(session.startMin)}</span>
            {" · "}
            {t("suggestedTime")}: <span className="tabular-nums" dir="ltr">{suggested}</span>
          </p>
          <FormField label={ts("startTime")} htmlFor="m-time">
            <Input id="m-time" type="time" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} />
          </FormField>
          <ConflictWarnings
            conflicts={conflictsFor({
              id: session.id,
              teacherId: targetTeacherId,
              studentId: session.studentId,
              startMin: hhmmToMin(time, session.startMin),
              hours: session.hours,
            })}
          />
          <p className="text-xs text-muted-foreground">{t("moveHint")}</p>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("cancel")}</Button>
          </DialogClose>
          <Button type="button" disabled={pending} onClick={submit}>
            {pending ? tc("saving") : sameTeacher ? tc("save") : t("move")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Manage the recurring weekly grid that "generate day" draws from. */
function TemplatesDialog({
  templates,
  teachers,
  students,
  onClose,
  onChanged,
}: {
  templates: PlannerTemplateRow[];
  teachers: Opt[];
  students: StudentOpt[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("planner");
  const tc = useTranslations("common");
  const ts = useTranslations("sessions");
  const te = useTranslations("enums");
  const locale = useLocale();

  const [pending, start] = useTransition();
  const [teacherId, setTeacherId] = useState(teachers[0]?.id ?? "");
  const [studentId, setStudentId] = useState("");
  const [weekday, setWeekday] = useState(String(WEEKDAY_ORDER[0]));
  const [time, setTime] = useState("14:00");
  const [hours, setHours] = useState("1");
  const [location, setLocation] = useState<"CENTER" | "HOME">("CENTER");

  const nameOf = (id: string, list: { id: string; label?: string; name?: string }[]) =>
    list.find((x) => x.id === id)?.label ?? list.find((x) => x.id === id)?.name ?? id;

  function add() {
    if (!teacherId || !studentId) return;
    start(async () => {
      const res = await saveTemplate(locale, {
        teacherId,
        studentId,
        weekday: parseInt(weekday, 10),
        startMin: hhmmToMin(time, 14 * 60),
        hours: parseFloat(hours) || 1,
        location,
      });
      if (res.ok) {
        setStudentId("");
        onChanged();
      }
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await deleteTemplate(locale, id);
      if (res.ok) onChanged();
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("templates")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("templatesHint")}</p>

          {/* Add row */}
          <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-2 sm:grid-cols-3">
            <FormField label={ts("teacher")} htmlFor="tpl-teacher">
              <Select id="tpl-teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                {teachers.map((x) => (
                  <option key={x.id} value={x.id}>{x.label}</option>
                ))}
              </Select>
            </FormField>
            <FormField label={ts("student")} htmlFor="tpl-student">
              <Combobox
                id="tpl-student"
                options={students.map((x) => ({ value: x.id, label: x.name }))}
                value={studentId}
                onChange={setStudentId}
              />
            </FormField>
            <FormField label={t("weekday")} htmlFor="tpl-weekday">
              <Select id="tpl-weekday" value={weekday} onChange={(e) => setWeekday(e.target.value)}>
                {WEEKDAY_ORDER.map((wd) => (
                  <option key={wd} value={wd}>{te(`weekday.${wd}`)}</option>
                ))}
              </Select>
            </FormField>
            <FormField label={ts("startTime")} htmlFor="tpl-time">
              <Input id="tpl-time" type="time" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} />
            </FormField>
            <FormField label={ts("hours")} htmlFor="tpl-hours">
              <Input
                id="tpl-hours"
                type="number"
                step="0.5"
                min="0.5"
                dir="ltr"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </FormField>
            <FormField label={ts("location")} htmlFor="tpl-loc">
              <Select
                id="tpl-loc"
                value={location}
                onChange={(e) => setLocation(e.target.value as "CENTER" | "HOME")}
              >
                <option value="CENTER">{te("location.CENTER")}</option>
                <option value="HOME">{te("location.HOME")}</option>
              </Select>
            </FormField>
            <div className="col-span-full flex justify-end">
              <Button size="sm" disabled={pending || !studentId} onClick={add}>
                {t("addTemplate")}
              </Button>
            </div>
          </div>

          {/* Existing templates, grouped Saturday-first */}
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {WEEKDAY_ORDER.map((wd) => {
              const rows = templates.filter((x) => x.weekday === wd);
              if (rows.length === 0) return null;
              return (
                <div key={wd}>
                  <div className="mb-1 text-sm font-medium">{te(`weekday.${wd}`)}</div>
                  <div className="space-y-1">
                    {rows.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                      >
                        <span className="tabular-nums" dir="ltr">
                          {minToHHMM(r.startMin)}–{minToHHMM(r.startMin + r.hours * 60)}
                        </span>
                        <span className="truncate">{nameOf(r.studentId, students)}</span>
                        <span className="truncate text-muted-foreground">
                          {nameOf(r.teacherId, teachers)}
                        </span>
                        {r.location === "HOME" && <Home className="size-3.5 shrink-0" />}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="ms-auto size-7"
                          aria-label={tc("delete")}
                          disabled={pending}
                          onClick={() => remove(r.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {templates.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">{tc("noData")}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("close")}</Button>
          </DialogClose>
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
