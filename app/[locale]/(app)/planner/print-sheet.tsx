"use client";

import { useMemo, type Dispatch, type SetStateAction } from "react";
import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
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
import { formatMoney } from "@/lib/money";
import { minToHHMM } from "@/lib/planner";
import type { PlannerSession } from "./planner-client";

type Opt = { id: string; label: string };

export type PrintOpts = {
  /** Teachers to print, in the order they appear on screen. */
  teacherIds: string[];
  /** Blank columns appended for hand-written additions. 0 ⇒ used columns only. */
  extraSlots: number;
  hideCancelled: boolean;
  showAmounts: boolean;
  showLevel: boolean;
  /** The student's home location code on home visits. The visit itself is
      always marked; this is the driving detail, which not every sheet wants. */
  showHomeCode: boolean;
};

export function defaultPrintOpts(
  teachers: Opt[],
  sessions: PlannerSession[],
): PrintOpts {
  // Pre-select exactly the teachers who have something to do — the common case
  // is a sheet for today's working staff, not the whole roster.
  const busy = new Set(
    sessions.filter((s) => s.status !== "CANCELLED").map((s) => s.teacherId),
  );
  return {
    teacherIds: teachers.filter((t) => busy.has(t.id)).map((t) => t.id),
    extraSlots: 0,
    hideCancelled: true,
    showAmounts: false,
    showLevel: false,
    showHomeCode: true,
  };
}

/** Sessions that will actually be printed, honouring the cancelled filter. */
function visibleFor(
  sessions: PlannerSession[],
  teacherId: string,
  hideCancelled: boolean,
) {
  return sessions
    .filter((s) => s.teacherId === teacherId)
    .filter((s) => !(hideCancelled && s.status === "CANCELLED"))
    .sort((a, b) => a.startMin - b.startMin);
}

/* ------------------------------------------------------------------ dialog */

export function PlannerPrintDialog({
  teachers,
  sessions,
  opts,
  onChange,
  onPrint,
  onClose,
}: {
  teachers: Opt[];
  sessions: PlannerSession[];
  opts: PrintOpts;
  /** A setState updater, not a plain setter: two changes landing in one React
      batch must compose rather than the second discarding the first. */
  onChange: Dispatch<SetStateAction<PrintOpts>>;
  onPrint: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("planner");
  const tc = useTranslations("common");

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) {
      if (opts.hideCancelled && s.status === "CANCELLED") continue;
      m.set(s.teacherId, (m.get(s.teacherId) ?? 0) + 1);
    }
    return m;
  }, [sessions, opts.hideCancelled]);

  const set = (patch: Partial<PrintOpts>) => onChange((p) => ({ ...p, ...patch }));
  const toggle = (id: string) =>
    onChange((p) => ({
      ...p,
      teacherIds: p.teacherIds.includes(id)
        ? p.teacherIds.filter((x) => x !== id)
        : // Keep roster order rather than click order, so the sheet always
          // reads the same way regardless of how it was selected.
          teachers.filter((x) => x.id === id || p.teacherIds.includes(x.id)).map((x) => x.id),
    }));

  const withSessions = teachers.filter((x) => (counts.get(x.id) ?? 0) > 0);
  const selectedCount = opts.teacherIds.length;
  const slotCount =
    Math.max(0, ...opts.teacherIds.map((id) => counts.get(id) ?? 0)) + opts.extraSlots;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("printOptions")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <FormField label={t("printTeachers")} hint={t("printTeachersHint")}>
            <div className="mb-2 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => set({ teacherIds: withSessions.map((x) => x.id) })}
              >
                {t("printWithSessions")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => set({ teacherIds: teachers.map((x) => x.id) })}
              >
                {t("printAllTeachers")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => set({ teacherIds: [] })}
              >
                {tc("clear")}
              </Button>
            </div>
            <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-border p-2">
              {teachers.map((x) => {
                const n = counts.get(x.id) ?? 0;
                return (
                  <label
                    key={x.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={opts.teacherIds.includes(x.id)}
                      onChange={() => toggle(x.id)}
                    />
                    <span className="truncate">{x.label}</span>
                    <span
                      className={
                        n === 0
                          ? "ms-auto shrink-0 text-xs text-muted-foreground"
                          : "ms-auto shrink-0 text-xs font-medium tabular-nums"
                      }
                    >
                      {n === 0 ? t("printNoSessions") : n}
                    </span>
                  </label>
                );
              })}
            </div>
          </FormField>

          <FormField
            label={t("printExtraSlots")}
            htmlFor="extra-slots"
            hint={t("printExtraSlotsHint")}
          >
            <Input
              id="extra-slots"
              type="number"
              min={0}
              max={5}
              dir="ltr"
              className="w-24"
              value={opts.extraSlots}
              onChange={(e) =>
                set({ extraSlots: Math.min(5, Math.max(0, Number(e.target.value) || 0)) })
              }
            />
          </FormField>

          <div className="space-y-2">
            {(
              [
                ["hideCancelled", t("printHideCancelled")],
                ["showHomeCode", t("printShowHomeCode")],
                ["showAmounts", t("printShowAmounts")],
                ["showLevel", t("printShowLevel")],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={opts[key]}
                  onChange={(e) => set({ [key]: e.target.checked } as Partial<PrintOpts>)}
                />
                {label}
              </label>
            ))}
          </div>

          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
            {t("printSummary", { teachers: selectedCount, columns: slotCount })}
          </p>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {tc("cancel")}
            </Button>
          </DialogClose>
          <Button type="button" className="gap-1" disabled={selectedCount === 0} onClick={onPrint}>
            <Printer className="size-4" />
            {t("printSheet")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------- sheet */

/**
 * The printed daily sheet.
 *
 * Deliberately *not* the screen grid: no status colours, no action buttons, no
 * drag affordances and no icons — those cost ink and page width without telling
 * a teacher anything they need on paper. What survives is the paper original's
 * shape (teacher rows × numbered slots) at a density that fits a real day on
 * one landscape page: time, student, and where to go.
 */
export function PlannerPrintSheet({
  day,
  weekdayLabel,
  centerName,
  centerLogo,
  teachers,
  sessions,
  opts,
}: {
  day: string;
  weekdayLabel: string;
  centerName: string;
  centerLogo: string;
  teachers: Opt[];
  sessions: PlannerSession[];
  opts: PrintOpts;
}) {
  const t = useTranslations("planner");
  const te = useTranslations("enums");

  const rows = teachers
    .filter((x) => opts.teacherIds.includes(x.id))
    .map((x) => ({ teacher: x, list: visibleFor(sessions, x.id, opts.hideCancelled) }));

  const slotCount = Math.max(1, ...rows.map((r) => r.list.length)) + opts.extraSlots;
  const total = rows
    .flatMap((r) => r.list)
    .filter((s) => s.status !== "CANCELLED")
    .reduce((sum, s) => sum + s.total, 0);
  const sessionCount = rows.reduce((n, r) => n + r.list.length, 0);

  return (
    <div data-print="A4L" className="hidden print:block">
      <div className="mb-1.5 flex items-baseline justify-between border-b border-black pb-1">
        <div className="flex items-center gap-2">
          {centerLogo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={centerLogo} alt="" className="max-h-8 object-contain" />
          )}
          <span className="text-[13px] font-bold">{centerName || t("sheetTitle")}</span>
          <span className="text-[10px]">{t("sheetTitle")}</span>
        </div>
        <div className="text-[10px]">
          <span dir="ltr">{day}</span> · {weekdayLabel} · {t("printCounts", {
            teachers: rows.length,
            sessions: sessionCount,
          })}
          {opts.showAmounts && <> · {formatMoney(total)}</>}
        </div>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="w-[14%]">{t("teacher")}</th>
            {Array.from({ length: slotCount }, (_, i) => (
              <th key={i} className="text-center tabular-nums">
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ teacher, list }) => (
            <tr key={teacher.id}>
              <td>
                <span className="font-bold">{teacher.label}</span>
                {list.length > 0 && (
                  <span className="ms-1 tabular-nums opacity-70">({list.length})</span>
                )}
              </td>
              {Array.from({ length: slotCount }, (_, i) => {
                const s = list[i];
                if (!s) return <td key={i} />;
                const end = s.startMin + s.hours * 60;
                return (
                  <td key={s.id} className={s.status === "CANCELLED" ? "line-through" : undefined}>
                    <div className="font-bold tabular-nums" dir="ltr">
                      {minToHHMM(s.startMin)}–{minToHHMM(end)}
                    </div>
                    <div className="truncate">{s.studentName}</div>
                    {/* Only home visits need a destination; the centre is implied. */}
                    {s.location === "HOME" && (
                      <div className="truncate">
                        {te("location.HOME")}
                        {opts.showHomeCode && s.homeCode ? ` · ${s.homeCode}` : ""}
                      </div>
                    )}
                    {(opts.showLevel || opts.showAmounts) && (
                      <div className="flex justify-between gap-1 opacity-70">
                        {opts.showLevel && <span className="truncate">{s.levelLabel}</span>}
                        {opts.showAmounts && (
                          <span className="ms-auto shrink-0 tabular-nums">
                            {formatMoney(s.total)}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
