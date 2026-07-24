"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Check,
  X,
  Undo2,
  ChevronLeft,
  ChevronRight,
  QrCode,
  Clock,
  Home,
  Building2,
  AlertTriangle,
  UserPlus,
} from "lucide-react";
import { useRouter, usePathname, Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TableSearch, useTableSearch } from "@/components/ui/table-search";
import { cn } from "@/lib/utils";
import { formatHours } from "@/lib/money";
import { minToHHMM } from "@/lib/planner";
import { localNowTime, localToday } from "@/lib/session-time";
import { Select } from "@/components/ui/select";
import { markAttendance, markAll, undoAutoComplete, confirmAutoComplete } from "./actions";
import { assignSessionTeacher } from "../settings/attendance-actions";
import { QrScanner } from "./qr-scanner";

export type RosterItem = {
  id: string;
  teacherId: string | null;
  teacherName: string;
  studentName: string;
  startMin: number;
  hours: number;
  location: "CENTER" | "HOME";
  status: string;
  autoCompleted: boolean;
};

/** Bucket key for sessions recorded before a teacher was assigned. */
const UNASSIGNED = "__unassigned__";

function addDaysStr(s: string, n: number) {
  const d = new Date(`${s}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Card tint by decision — green taken, red absent, neutral still pending. */
const CARD_STYLE: Record<string, string> = {
  COMPLETED: "border-[var(--success)] bg-success/10",
  CHECKED_IN: "border-warning bg-warning/10",
  NO_SHOW: "border-destructive bg-destructive/10",
  CANCELLED: "border-border bg-muted text-muted-foreground line-through",
  SCHEDULED: "border-border bg-card",
  DRAFT: "border-warning border-dashed bg-warning/5",
};

/**
 * Attendance for a whole day on one screen.
 *
 * Built around the fact that attendance is nearly always "everyone came": the
 * default action is one tap for a teacher's entire row, and you only touch
 * individual students to record the exceptions. The old kiosk made you search
 * for every student individually, which is the opposite trade.
 */
export function RosterBoard({
  day,
  items,
  pendingReview,
  needsTeacher,
  dayTeachers,
}: {
  day: string;
  items: RosterItem[];
  pendingReview: RosterItem[];
  /** Walk-ins recorded before anyone knew who taught them. */
  needsTeacher: RosterItem[];
  /** Only teachers who actually worked that day are offered. */
  dayTeachers: { id: string; label: string }[];
}) {
  const t = useTranslations("checkin");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const [pending, start] = useTransition();
  const [scanOpen, setScanOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const search = useTableSearch(items, (i) => [i.studentName, i.teacherName]);

  const byTeacher = useMemo(() => {
    const m = new Map<string, RosterItem[]>();
    for (const it of search.filtered) {
      // Walk-ins with no teacher yet share one bucket so they stay visible
      // instead of vanishing from a teacher-keyed grouping.
      const key = it.teacherId ?? UNASSIGNED;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(it);
    }
    for (const list of m.values()) list.sort((a, b) => a.startMin - b.startMin);
    return [...m.entries()].sort((a, b) =>
      (a[1][0]?.teacherName ?? "").localeCompare(b[1][0]?.teacherName ?? "", "ar"),
    );
  }, [search.filtered]);

  // "Pending" is what still needs a human decision — the number that matters.
  const decided = items.filter((i) => i.status === "COMPLETED" || i.status === "NO_SHOW");
  const awaiting = items.filter((i) => i.status === "SCHEDULED" || i.status === "CHECKED_IN");
  const hoursDone = decided
    .filter((i) => i.status === "COMPLETED")
    .reduce((sum, i) => sum + i.hours, 0);

  const today = localToday();
  const go = (d: string) => router.push(`${pathname}?date=${d}`);
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
          <Button variant="ghost" size="icon" aria-label={tc("prev")} onClick={() => go(addDaysStr(day, -1))}>
            <ChevronRight className="size-4 rtl:hidden" />
            <ChevronLeft className="hidden size-4 rtl:block" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={tc("next")} onClick={() => go(addDaysStr(day, 1))}>
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

        <TableSearch
          value={search.query}
          onChange={search.setQuery}
          placeholder={t("searchPlaceholder")}
          className="min-w-48"
        />

        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Badge variant="default">{t("awaiting", { n: awaiting.length })}</Badge>
          <Badge variant="success">{t("hoursRecorded", { h: formatHours(hoursDone) })}</Badge>
          <Button variant="secondary" size="sm" className="gap-1" onClick={() => setScanOpen(true)}>
            <QrCode className="size-4" />
            {t("scan")}
          </Button>
          <Link href="/checkin/cards">
            <Button variant="ghost" size="sm">{t("cards")}</Button>
          </Link>
          <Button
            size="sm"
            className="gap-1"
            disabled={pending || awaiting.length === 0}
            onClick={() => run(() => markAll(locale, { date: day, mark: "COMPLETED" }))}
          >
            <Check className="size-4" />
            {t("allPresentDay")}
          </Button>
        </div>
      </div>

      {flash && (
        <p className="rounded-md bg-success/15 px-3 py-2 text-sm text-[var(--success)]" role="status">
          {flash}
        </p>
      )}

      {/* Walk-ins still missing a teacher — nobody's payroll moves until set */}
      {needsTeacher.length > 0 && (
        <div className="rounded-lg border border-primary bg-primary/5 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <UserPlus className="size-4" />
            {t("needsTeacherTitle", { n: needsTeacher.length })}
          </div>
          <div className="space-y-1">
            {needsTeacher.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background px-2 py-1.5 text-sm"
              >
                <span className="font-medium">{r.studentName}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                    {minToHHMM(r.startMin)}
                  </span>
                  <Select
                    aria-label={t("assignTeacher")}
                    className="w-44"
                    defaultValue=""
                    disabled={pending}
                    onChange={(e) =>
                      e.target.value &&
                      run(() =>
                        assignSessionTeacher(locale, {
                          sessionId: r.id,
                          teacherId: e.target.value,
                        }),
                      )
                    }
                  >
                    <option value="">{t("assignTeacher")}</option>
                    {dayTeachers.map((x) => (
                      <option key={x.id} value={x.id}>{x.label}</option>
                    ))}
                  </Select>
                </span>
              </div>
            ))}
          </div>
          {dayTeachers.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">{t("noDayTeachers")}</p>
          )}
        </div>
      )}

      {/* Sessions the sweep completed on its own, awaiting a human */}
      {pendingReview.length > 0 && (
        <div className="rounded-lg border border-warning bg-warning/10 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium">
              <AlertTriangle className="size-4" />
              {t("reviewTitle", { n: pendingReview.length })}
            </span>
            <span className="text-xs text-muted-foreground">{t("reviewHint")}</span>
          </div>
          <div className="space-y-1">
            {pendingReview.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background px-2 py-1.5 text-sm"
              >
                <span>
                  <span className="font-medium">{r.studentName}</span>
                  <span className="text-muted-foreground"> · {r.teacherName}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                    {minToHHMM(r.startMin)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => run(() => confirmAutoComplete(locale, r.id))}
                  >
                    {t("accept")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={t("undo")}
                    title={t("undo")}
                    disabled={pending}
                    onClick={() => run(() => undoAutoComplete(locale, r.id))}
                  >
                    <Undo2 className="size-3.5" />
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Roster */}
      {byTeacher.length === 0 && (
        <p className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {tc("noData")}
        </p>
      )}

      {byTeacher.map(([teacherId, list]) => {
        const rowAwaiting = list.filter(
          (i) => i.status === "SCHEDULED" || i.status === "CHECKED_IN",
        );
        return (
          <div key={teacherId} className="rounded-lg border border-border bg-card p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">
                {list[0]?.teacherName || t("noTeacher")}
              </span>
              <span className="flex items-center gap-1">
                <span className="me-1 text-xs text-muted-foreground">
                  {t("rowSummary", { done: list.length - rowAwaiting.length, total: list.length })}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="gap-1"
                  disabled={pending || rowAwaiting.length === 0}
                  onClick={() =>
                    run(() =>
                      markAll(locale, {
                        date: day,
                        mark: "COMPLETED",
                        teacherId: teacherId === UNASSIGNED ? null : teacherId,
                      }),
                    )
                  }
                >
                  <Check className="size-3.5" />
                  {t("allPresent")}
                </Button>
              </span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((it) => {
                const done = it.status === "COMPLETED";
                const absent = it.status === "NO_SHOW";
                return (
                  <div
                    key={it.id}
                    className={cn(
                      "rounded-lg border-2 p-2 transition-colors",
                      CARD_STYLE[it.status] ?? CARD_STYLE.SCHEDULED,
                    )}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="truncate font-medium">{it.studentName}</span>
                      {it.location === "HOME" ? (
                        <Home className="size-3.5 shrink-0" />
                      ) : (
                        <Building2 className="size-3.5 shrink-0 opacity-50" />
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="size-3" />
                      <span className="tabular-nums" dir="ltr">
                        {minToHHMM(it.startMin)}–{minToHHMM(it.startMin + it.hours * 60)}
                      </span>
                      {it.autoCompleted && (
                        <Badge variant="warning" className="ms-auto px-1 py-0 text-[10px]">
                          {t("autoTag")}
                        </Badge>
                      )}
                    </div>

                    {it.status === "DRAFT" || it.status === "CANCELLED" ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {te(`sessionStatus.${it.status}`)}
                      </p>
                    ) : (
                      <div className="mt-2 grid grid-cols-2 gap-1">
                        <Button
                          size="sm"
                          variant={done ? "default" : "outline"}
                          className="gap-1"
                          disabled={pending}
                          onClick={() =>
                            run(() =>
                              markAttendance(locale, {
                                sessionId: it.id,
                                // Tapping the active state clears it, so a
                                // mis-tap is undone the same way it was made.
                                mark: done ? "SCHEDULED" : "COMPLETED",
                              }),
                            )
                          }
                        >
                          <Check className="size-3.5" />
                          {t("present")}
                        </Button>
                        <Button
                          size="sm"
                          variant={absent ? "destructive" : "outline"}
                          className="gap-1"
                          disabled={pending}
                          onClick={() =>
                            run(() =>
                              markAttendance(locale, {
                                sessionId: it.id,
                                mark: absent ? "SCHEDULED" : "NO_SHOW",
                              }),
                            )
                          }
                        >
                          <X className="size-3.5" />
                          {t("absent")}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {scanOpen && (
        <QrScanner
          day={day}
          onClose={() => setScanOpen(false)}
          onResult={(msg) => {
            setFlash(msg);
            router.refresh();
            setTimeout(() => setFlash(null), 4000);
          }}
        />
      )}
    </div>
  );
}
