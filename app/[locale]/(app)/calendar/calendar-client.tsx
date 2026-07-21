"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Plus, Home, Building2, Users, Printer } from "lucide-react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { printDoc } from "@/lib/print";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import {
  SessionDialog,
  type StudentOpt,
  type Opt,
  type PriceMatrix,
  type SessionInit,
} from "../sessions/session-dialog";
import { saveSession } from "../sessions/actions";
import { GroupBookingDialog } from "../sessions/group-booking-dialog";
import { rescheduleSession, resizeSession } from "./actions";

export type CalEvent = {
  id: string;
  day: string; // YYYY-MM-DD
  startMinutes: number; // minutes from midnight
  hours: number;
  studentId: string;
  studentName: string;
  teacherId: string | null;
  teacherName: string;
  gradeLevelId: string;
  levelLabel: string;
  location: "CENTER" | "HOME";
  status: string;
  paymentStatus: string;
  total: number;
};

const START_HOUR = 7;
const END_HOUR = 23;
/** Row height per density. Compact halves it so a full week fits one screen. */
const HOUR_PX_BY_DENSITY = { normal: 56, compact: 28 } as const;
const SNAP_MIN = 15;
const GRID_MIN = START_HOUR * 60;
const GRID_MAX = END_HOUR * 60;

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "border-s-warning border-dashed bg-warning/10 opacity-80",
  SCHEDULED: "border-s-primary bg-primary/10",
  CHECKED_IN: "border-s-warning bg-warning/20",
  COMPLETED: "border-s-success bg-success/20",
  NO_SHOW: "border-s-destructive bg-destructive/15",
  CANCELLED: "border-s-muted-foreground bg-muted text-muted-foreground line-through",
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function fmtTime(min: number) {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}
function snap(min: number) {
  return Math.round(min / SNAP_MIN) * SNAP_MIN;
}
function addDaysStr(s: string, n: number) {
  const d = new Date(`${s}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Lay overlapping events into side-by-side lanes within a day column.
 *
 * Lane width is decided per *cluster* of mutually-overlapping events, not per
 * column: two events clashing at 09:00 must not squeeze an unrelated 18:00
 * event to half width, which is what a column-wide lane count would do.
 */
function layout(events: CalEvent[]) {
  const sorted = [...events].sort((a, b) => a.startMinutes - b.startMinutes);
  const endOf = (e: CalEvent) => e.startMinutes + e.hours * 60;

  const placed: { ev: CalEvent; lane: number; lanes: number }[] = [];
  let cluster: { ev: CalEvent; lane: number }[] = [];
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];

  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const p of cluster) placed.push({ ...p, lanes });
    cluster = [];
    laneEnds = [];
  };

  for (const ev of sorted) {
    // A gap with everything so far closes the cluster and resets lane widths.
    if (ev.startMinutes >= clusterEnd && cluster.length) flush();
    let lane = laneEnds.findIndex((e) => e <= ev.startMinutes);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endOf(ev));
    } else {
      laneEnds[lane] = endOf(ev);
    }
    cluster.push({ ev, lane });
    clusterEnd = Math.max(clusterEnd, endOf(ev));
  }
  if (cluster.length) flush();

  return placed;
}

export type CalendarView = "week" | "day" | "compact" | "list";

type Ghost = { id: string; day: string; startMinutes: number; hours: number };

export function CalendarClient({
  view,
  anchor,
  days,
  events: eventsProp,
  currency,
  students,
  teachers,
  levels,
  matrix,
  teacherFilter,
  studentFilter,
  centerName,
}: {
  view: CalendarView;
  anchor: string;
  days: string[];
  events: CalEvent[];
  currency: string;
  students: StudentOpt[];
  teachers: Opt[];
  levels: Opt[];
  matrix: PriceMatrix;
  teacherFilter: string;
  studentFilter: string;
  centerName: string;
}) {
  const t = useTranslations("calendar");
  const tg = useTranslations("group");
  const te = useTranslations("enums");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const [events, setEvents] = useState<CalEvent[]>(eventsProp);
  useEffect(() => setEvents(eventsProp), [eventsProp]);

  const [ghost, setGhost] = useState<Ghost | null>(null);
  const ghostRef = useRef<Ghost | null>(null);
  const setGhostBoth = (g: Ghost | null) => {
    ghostRef.current = g;
    setGhost(g);
  };

  const gridRef = useRef<HTMLDivElement>(null);
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragRef = useRef<null | {
    id: string;
    mode: "move" | "resize";
    grabOffsetMin: number;
    ev: CalEvent;
    moved: boolean;
    x0: number;
    y0: number;
  }>(null);

  const [createAt, setCreateAt] = useState<{ date: string; time: string } | null>(null);
  const [editEv, setEditEv] = useState<CalEvent | null>(null);

  // Compact is the same grid at half row height; list bypasses the grid entirely.
  const compact = view === "compact";
  const isGrid = view !== "list";
  const hourPx = HOUR_PX_BY_DENSITY[compact ? "compact" : "normal"];

  // ---- geometry helpers ----
  function pointerMinutes(clientY: number) {
    const top = gridRef.current?.getBoundingClientRect().top ?? 0;
    return GRID_MIN + ((clientY - top) / hourPx) * 60;
  }
  function dayFromX(clientX: number): string | null {
    for (let i = 0; i < colRefs.current.length; i++) {
      const el = colRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) return days[i];
    }
    return null;
  }

  function onPointerDownEvent(
    e: React.PointerEvent,
    ev: CalEvent,
    mode: "move" | "resize",
  ) {
    e.stopPropagation();
    e.preventDefault();
    const grabOffsetMin = mode === "move" ? pointerMinutes(e.clientY) - ev.startMinutes : 0;
    dragRef.current = { id: ev.id, mode, grabOffsetMin, ev, moved: false, x0: e.clientX, y0: e.clientY };
    setGhostBoth({ id: ev.id, day: ev.day, startMinutes: ev.startMinutes, hours: ev.hours });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onMove(e: PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 4) d.moved = true;
    if (d.mode === "move") {
      let start = snap(pointerMinutes(e.clientY) - d.grabOffsetMin);
      const dur = d.ev.hours * 60;
      start = Math.max(GRID_MIN, Math.min(start, GRID_MAX - dur));
      const day = dayFromX(e.clientX) ?? d.ev.day;
      setGhostBoth({ id: d.id, day, startMinutes: start, hours: d.ev.hours });
    } else {
      let hrs = snap(pointerMinutes(e.clientY) - d.ev.startMinutes) / 60;
      hrs = Math.max(0.25, Math.min(hrs, (GRID_MAX - d.ev.startMinutes) / 60));
      setGhostBoth({ id: d.id, day: d.ev.day, startMinutes: d.ev.startMinutes, hours: hrs });
    }
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    const d = dragRef.current;
    dragRef.current = null;
    const g = ghostRef.current;
    setGhostBoth(null);
    if (!d) return;

    if (!d.moved) {
      // treated as a click → open edit
      setEditEv(d.ev);
      return;
    }
    if (!g) return;

    // optimistic update
    setEvents((prev) =>
      prev.map((x) =>
        x.id === d.id ? { ...x, day: g.day, startMinutes: g.startMinutes, hours: g.hours } : x,
      ),
    );

    (async () => {
      const res =
        d.mode === "move"
          ? await rescheduleSession(locale, { id: d.id, date: g.day, time: fmtTime(g.startMinutes) })
          : await resizeSession(locale, { id: d.id, hours: g.hours });
      if (!res.ok) {
        setEvents(eventsProp); // revert
      } else {
        router.refresh();
      }
    })();
  }

  // ---- navigation ----
  function go(params: Record<string, string>) {
    // Every filter has to survive every other navigation. `go` does not read
    // the live URL, so each param must be re-applied explicitly or it is lost
    // silently on the next prev/next click.
    const sp = new URLSearchParams({ view, date: anchor, ...params });
    for (const [key, current] of [
      ["teacher", teacherFilter],
      ["student", studentFilter],
    ] as const) {
      const next = params[key] ?? current;
      if (next) sp.set(key, next);
      else sp.delete(key);
    }
    router.push(`${pathname}?${sp.toString()}`);
  }
  const step = view === "day" ? 1 : 7;
  const today = new Date().toISOString().slice(0, 10);

  const rangeLabel = useMemo(() => {
    const fmt = (s: string) =>
      new Date(`${s}T00:00:00.000Z`).toLocaleDateString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
        day: "2-digit",
        month: "short",
        timeZone: "UTC",
      });
    return view === "day" ? fmt(days[0]) : `${fmt(days[0])} – ${fmt(days[days.length - 1])}`;
  }, [days, view, locale]);

  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

  const editInit: SessionInit | undefined = editEv
    ? {
        id: editEv.id,
        date: editEv.day,
        time: fmtTime(editEv.startMinutes),
        studentId: editEv.studentId,
        teacherId: editEv.teacherId ?? "",
        gradeLevelId: editEv.gradeLevelId,
        location: editEv.location,
        hours: editEv.hours,
        paymentStatus: editEv.paymentStatus,
        notes: null,
      }
    : undefined;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
        <Button variant="secondary" size="sm" onClick={() => go({ date: today })}>
          {t("today")}
        </Button>
        <div className="flex items-center">
          <Button variant="ghost" size="icon" aria-label={t("prev")} onClick={() => go({ date: addDaysStr(anchor, -step) })}>
            <ChevronRight className="size-4 rtl:hidden" />
            <ChevronLeft className="hidden size-4 rtl:block" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t("next")} onClick={() => go({ date: addDaysStr(anchor, step) })}>
            <ChevronLeft className="size-4 rtl:hidden" />
            <ChevronRight className="hidden size-4 rtl:block" />
          </Button>
        </div>
        <span className="min-w-32 text-sm font-semibold tabular-nums">{rangeLabel}</span>

        <Combobox
          aria-label={t("filterTeacher")}
          className="w-44"
          placeholder={t("allTeachers")}
          options={teachers.map((tt) => ({ value: tt.id, label: tt.label }))}
          value={teacherFilter}
          onChange={(v) => go({ teacher: v })}
        />
        <Combobox
          aria-label={t("filterStudent")}
          className="w-44"
          placeholder={t("allStudents")}
          options={students.map((st) => ({ value: st.id, label: st.name }))}
          value={studentFilter}
          onChange={(v) => go({ student: v })}
        />

        <div className="ms-auto flex items-center gap-1 rounded-md border border-border p-0.5">
          {(["week", "day", "compact", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => go({ view: v })}
              className={cn(
                "rounded px-3 py-1 text-sm",
                view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {t(v)}
            </button>
          ))}
        </div>
        {view === "list" && (
          <Button variant="secondary" size="sm" className="gap-1" onClick={() => printDoc("A4 portrait")}>
            <Printer className="size-4" />
            {tc("print")}
          </Button>
        )}
        <GroupBookingDialog
          students={students}
          teachers={teachers}
          levels={levels}
          matrix={matrix}
          currency={currency}
          defaultDate={days[0]}
          defaultTime="16:00"
          onSaved={() => router.refresh()}
          trigger={
            <Button size="sm" variant="secondary" className="gap-1">
              <Users className="size-4" />
              {tg("short")}
            </Button>
          }
        />
        <Button size="sm" className="gap-1" onClick={() => setCreateAt({ date: days[0], time: "16:00" })}>
          <Plus className="size-4" />
          {t("add")}
        </Button>
      </div>

      {/* Legend */}
      <div className="no-print flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
        {(["DRAFT", "SCHEDULED", "CHECKED_IN", "COMPLETED", "NO_SHOW", "CANCELLED"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-block size-3 rounded-sm border-s-4", STATUS_STYLES[s])} />
            {te(`sessionStatus.${s}`)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1"><Home className="size-3" /> {te("location.HOME")}</span>
      </div>

      {view === "list" && (
        <ListView
          events={events}
          days={days}
          rangeLabel={rangeLabel}
          centerName={centerName}
          onEdit={setEditEv}
        />
      )}

      {/* Calendar grid */}
      {isGrid && (
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <div className="min-w-[720px]">
          {/* Day headers */}
          <div className="flex border-b border-border">
            <div className="w-14 shrink-0" />
            {days.map((d) => {
              const dt = new Date(`${d}T00:00:00.000Z`);
              const isToday = d === today;
              return (
                <div
                  key={d}
                  className={cn(
                    "flex-1 border-s border-border px-2 py-2 text-center",
                    isToday && "bg-accent/50",
                  )}
                >
                  <div className="text-xs text-muted-foreground">
                    {dt.toLocaleDateString(locale === "ar" ? "ar-EG" : "en-US", { weekday: "short", timeZone: "UTC" })}
                  </div>
                  <div className={cn("text-sm font-semibold tabular-nums", isToday && "text-primary")}>
                    {dt.toLocaleDateString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { day: "2-digit", month: "2-digit", timeZone: "UTC" })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Body: hour gutter + day columns */}
          <div className="flex">
            {/* Gutter */}
            <div className="w-14 shrink-0">
              {hours.map((h) => (
                <div key={h} className="relative border-b border-border/60" style={{ height: hourPx }}>
                  <span className="absolute -top-2 end-1 text-[10px] tabular-nums text-muted-foreground">{pad(h)}:00</span>
                </div>
              ))}
            </div>

            {/* Columns */}
            <div ref={gridRef} className="flex flex-1">
              {days.map((day, ci) => {
                const dayEvents = events.filter((e) => e.day === day && (!ghost || ghost.id !== e.id));
                const ghostHere = ghost && ghost.day === day
                  ? { ...(events.find((e) => e.id === ghost.id)!), day, startMinutes: ghost.startMinutes, hours: ghost.hours }
                  : null;
                const all = ghostHere ? [...dayEvents, ghostHere] : dayEvents;
                const placed = layout(all);
                return (
                  <div
                    key={day}
                    ref={(el) => { colRefs.current[ci] = el; }}
                    className="relative flex-1 border-s border-border"
                    onClick={(e) => {
                      const top = (e.currentTarget as HTMLElement).getBoundingClientRect().top;
                      const min = Math.max(GRID_MIN, Math.min(GRID_MAX - 60, snap(GRID_MIN + ((e.clientY - top) / hourPx) * 60)));
                      setCreateAt({ date: day, time: fmtTime(min) });
                    }}
                  >
                    {/* hour cells */}
                    {hours.map((h) => (
                      <div key={h} className="border-b border-border/60" style={{ height: hourPx }} />
                    ))}

                    {/* now indicator */}
                    {day === today && <NowLine hourPx={hourPx} />}

                    {/* events */}
                    {placed.map(({ ev, lane, lanes }) => {
                      const isGhost = ghost?.id === ev.id;
                      const width = 100 / lanes;
                      const top = ((ev.startMinutes - GRID_MIN) / 60) * hourPx;
                      const height = Math.max(compact ? 12 : 18, (ev.hours * 60) / 60 * hourPx);
                      return (
                        <div
                          key={ev.id + (isGhost ? "-g" : "")}
                          onPointerDown={(e) => onPointerDownEvent(e, ev, "move")}
                          onClick={(e) => e.stopPropagation()}
                          className={cn(
                            "absolute z-10 cursor-grab touch-none overflow-hidden rounded-md border-s-4 px-1.5 py-1 text-[11px] shadow-sm active:cursor-grabbing",
                            STATUS_STYLES[ev.status] ?? STATUS_STYLES.SCHEDULED,
                            isGhost && "opacity-70 ring-2 ring-ring",
                          )}
                          style={{
                            top,
                            height,
                            insetInlineStart: `calc(${lane * width}% + 2px)`,
                            width: `calc(${width}% - 4px)`,
                          }}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate font-semibold">{ev.studentName}</span>
                            {ev.location === "HOME" ? <Home className="size-3 shrink-0" /> : <Building2 className="size-3 shrink-0 opacity-60" />}
                          </div>
                          {!compact && (
                            <>
                              <div className="truncate opacity-80">{ev.teacherName}</div>
                              <div className="tabular-nums opacity-70">
                                {fmtTime(ev.startMinutes)} · {ev.hours}
                                {"h"} · {formatMoney(ev.total)} {currency}
                              </div>
                            </>
                          )}
                          {/* resize handle */}
                          <div
                            onPointerDown={(e) => onPointerDownEvent(e, ev, "resize")}
                            className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Quick-create dialog */}
      {createAt && (
        <SessionDialog
          title={t("add")}
          action={saveSession.bind(null, locale, null)}
          students={students}
          teachers={teachers}
          levels={levels}
          matrix={matrix}
          currency={currency}
          open={!!createAt}
          onOpenChange={(v) => !v && setCreateAt(null)}
          defaultDate={createAt.date}
          defaultTime={createAt.time}
          onSaved={() => { setCreateAt(null); router.refresh(); }}
        />
      )}

      {/* Edit dialog (from clicking an event) */}
      {editEv && editInit && (
        <SessionDialog
          title={t("edit")}
          action={saveSession.bind(null, locale, editEv.id)}
          students={students}
          teachers={teachers}
          levels={levels}
          matrix={matrix}
          currency={currency}
          session={editInit}
          open={!!editEv}
          onOpenChange={(v) => !v && setEditEv(null)}
          onSaved={() => { setEditEv(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

/**
 * Flat chronological schedule — the printable view.
 *
 * Deliberately not the grid: a week grid on paper wastes most of the page on
 * empty hours, while a list prints only the sessions that exist and paginates
 * naturally across A4 pages.
 */
function ListView({
  events,
  days,
  rangeLabel,
  centerName,
  onEdit,
}: {
  events: CalEvent[];
  days: string[];
  rangeLabel: string;
  centerName: string;
  onEdit: (ev: CalEvent) => void;
}) {
  const t = useTranslations("calendar");
  const ts = useTranslations("sessions");
  const tc = useTranslations("common");
  const te = useTranslations("enums");

  // Day order follows the visible range, so the printed sheet matches the grid.
  const rank = new Map(days.map((d, i) => [d, i]));
  const rows = [...events].sort(
    (a, b) =>
      (rank.get(a.day) ?? 0) - (rank.get(b.day) ?? 0) || a.startMinutes - b.startMinutes,
  );

  return (
    <div data-print="A4" className="rounded-lg border border-border bg-card">
      {/* Print-only header — the toolbar is hidden on paper. */}
      <div className="hidden print:mb-3 print:block print:text-center">
        <div className="font-bold">{centerName}</div>
        <div className="text-sm">
          {t("title")} · <span dir="ltr">{rangeLabel}</span>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tc("date")}</TableHead>
            <TableHead>{ts("startTime")}</TableHead>
            <TableHead>{ts("student")}</TableHead>
            <TableHead>{ts("teacher")}</TableHead>
            <TableHead>{ts("location")}</TableHead>
            <TableHead className="text-end">{tc("hours")}</TableHead>
            <TableHead>{tc("status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                {tc("noData")}
              </TableCell>
            </TableRow>
          )}
          {rows.map((ev) => (
            <TableRow
              key={ev.id}
              className="cursor-pointer"
              onClick={() => onEdit(ev)}
            >
              <TableCell className="tabular-nums" dir="ltr">{ev.day}</TableCell>
              <TableCell className="tabular-nums" dir="ltr">{fmtTime(ev.startMinutes)}</TableCell>
              <TableCell className="font-medium">{ev.studentName}</TableCell>
              <TableCell>{ev.teacherName}</TableCell>
              <TableCell>{te(`location.${ev.location}`)}</TableCell>
              <TableCell className="text-end tabular-nums">{ev.hours}</TableCell>
              <TableCell>
                <Badge variant={ev.status === "COMPLETED" ? "success" : ev.status === "CANCELLED" ? "muted" : "default"}>
                  {te(`sessionStatus.${ev.status}`)}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function NowLine({ hourPx }: { hourPx: number }) {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const min = now.getHours() * 60 + now.getMinutes();
      if (min < GRID_MIN || min > GRID_MAX) return setTop(null);
      setTop(((min - GRID_MIN) / 60) * hourPx);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [hourPx]);
  if (top === null) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top }}>
      <div className="h-0.5 bg-destructive" />
    </div>
  );
}
