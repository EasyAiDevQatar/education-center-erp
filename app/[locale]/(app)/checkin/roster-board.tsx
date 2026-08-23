"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Home,
  LayoutGrid,
  List,
  LogIn,
  LogOut,
  QrCode,
  Undo2,
  UserPlus,
  X,
} from "lucide-react";
import { useRouter, usePathname, Link } from "@/i18n/navigation";
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
import { TableSearch, useTableSearch } from "@/components/ui/table-search";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { cn } from "@/lib/utils";
import { formatHours } from "@/lib/money";
import { minToHHMM } from "@/lib/planner";
import { centerToday, formatDurationClock } from "@/lib/session-time";
import { Select } from "@/components/ui/select";
import {
  checkOutSession,
  confirmAutoComplete,
  manualCheckInSession,
  markAll,
  markNoShow,
  undoAutoComplete,
  undoCheckin,
} from "./actions";
import { assignSessionTeacher } from "../settings/attendance-actions";
import { QrScanner } from "./qr-scanner";

export type AttendanceTab = "attendance" | "needs-teacher" | "review";
export type AttendanceView = "list" | "cards";

export type RosterItem = {
  id: string;
  sessionDate: string;
  teacherId: string | null;
  teacherName: string;
  studentName: string;
  startMin: number;
  hours: number;
  location: "CENTER" | "HOME";
  status: string;
  autoCompleted: boolean;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  checkInMethod: string | null;
  actualMinutes: number | null;
  billableMinutes: number;
};

type ActionResult = { ok?: boolean; error?: string; count?: number };
type ActionRunner = (fn: () => Promise<ActionResult>) => void;

/** Bucket key for sessions recorded before a teacher was assigned. */
const UNASSIGNED = "__unassigned__";

function addDaysStr(s: string, n: number) {
  const d = new Date(`${s}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const STATUS_BADGE: Record<string, "success" | "warning" | "muted" | "destructive"> = {
  SCHEDULED: "muted",
  CHECKED_IN: "warning",
  COMPLETED: "success",
  NO_SHOW: "destructive",
  CANCELLED: "muted",
};

const CARD_STYLE: Record<string, string> = {
  COMPLETED: "border-[var(--success)] bg-success/10",
  CHECKED_IN: "border-warning bg-warning/10",
  NO_SHOW: "border-destructive bg-destructive/10",
  CANCELLED: "border-border bg-muted text-muted-foreground line-through",
  SCHEDULED: "border-border bg-card",
};

function StatusBadge({ status }: { status: string }) {
  const te = useTranslations("enums");
  return (
    <Badge variant={STATUS_BADGE[status] ?? "muted"}>
      {te(`sessionStatus.${status}`)}
    </Badge>
  );
}

/** The same state machine is used in list and card views so switching layout
 * can never change what staff are allowed to do. */
function SessionActions({
  item,
  pending,
  run,
}: {
  item: RosterItem;
  pending: boolean;
  run: ActionRunner;
}) {
  const t = useTranslations("checkin");
  const locale = useLocale();

  if (item.status === "SCHEDULED") {
    return (
      <div className="flex flex-wrap justify-center gap-1">
        <Button
          size="sm"
          className="gap-1"
          disabled={pending}
          onClick={() => run(() => manualCheckInSession(locale, item.id))}
        >
          <LogIn className="size-3.5" />
          {t("checkIn")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1 text-destructive"
          disabled={pending}
          onClick={() => run(() => markNoShow(locale, item.id))}
        >
          <X className="size-3.5" />
          {t("absent")}
        </Button>
      </div>
    );
  }

  if (item.status === "CHECKED_IN") {
    return (
      <div className="flex flex-wrap justify-center gap-1">
        <Button
          size="sm"
          className="gap-1"
          disabled={pending}
          onClick={() => run(() => checkOutSession(locale, item.id))}
        >
          <LogOut className="size-3.5" />
          {t("checkOut")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="gap-1"
          disabled={pending}
          onClick={() => run(() => undoCheckin(locale, item.id))}
        >
          <Undo2 className="size-3.5" />
          {t("undo")}
        </Button>
      </div>
    );
  }

  if (item.status === "COMPLETED" || item.status === "NO_SHOW") {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="gap-1"
        disabled={pending}
        onClick={() => run(() => undoCheckin(locale, item.id))}
      >
        <Undo2 className="size-3.5" />
        {t("undo")}
      </Button>
    );
  }

  return <span className="text-muted-foreground">—</span>;
}

function AttendanceList({
  rows,
  query,
  pending,
  run,
}: {
  rows: RosterItem[];
  query: string;
  pending: boolean;
  run: ActionRunner;
}) {
  const t = useTranslations("checkin");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const pg = usePagination(rows, 20, query);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("studentColumn")}</TableHead>
              <TableHead>{t("teacherColumn")}</TableHead>
              <TableHead>{t("locationColumn")}</TableHead>
              <TableHead>{t("scheduledColumn")}</TableHead>
              <TableHead>{t("checkInColumn")}</TableHead>
              <TableHead>{t("checkOutColumn")}</TableHead>
              <TableHead>{t("actualColumn")}</TableHead>
              <TableHead>{t("billableColumn")}</TableHead>
              <TableHead>{t("methodColumn")}</TableHead>
              <TableHead>{tc("status")}</TableHead>
              <TableHead>{t("actionsColumn")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pg.pageItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="py-10 text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((item) => (
              <TableRow key={item.id} className={item.status === "CANCELLED" ? "opacity-60" : undefined}>
                <TableCell className="font-medium">{item.studentName}</TableCell>
                <TableCell>{item.teacherName || t("noTeacher")}</TableCell>
                <TableCell>{te(`location.${item.location}`)}</TableCell>
                <TableCell className="tabular-nums" dir="ltr">
                  {minToHHMM(item.startMin)}–{minToHHMM(item.startMin + item.hours * 60)}
                </TableCell>
                <TableCell className="tabular-nums" dir="ltr">{item.checkedInAt ?? "—"}</TableCell>
                <TableCell className="tabular-nums" dir="ltr">{item.checkedOutAt ?? "—"}</TableCell>
                <TableCell className="tabular-nums" dir="ltr">
                  {item.actualMinutes == null ? "—" : formatDurationClock(item.actualMinutes)}
                </TableCell>
                <TableCell className="tabular-nums" dir="ltr">
                  {formatDurationClock(item.billableMinutes)}
                </TableCell>
                <TableCell>
                  {item.checkInMethod ? te(`checkinMethod.${item.checkInMethod}`) : "—"}
                </TableCell>
                <TableCell><StatusBadge status={item.status} /></TableCell>
                <TableCell><SessionActions item={item} pending={pending} run={run} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="divide-y divide-border lg:hidden">
        {pg.pageItems.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">{tc("noData")}</p>
        )}
        {pg.pageItems.map((item) => (
          <div key={item.id} className={cn("space-y-2 p-3", item.status === "CANCELLED" && "opacity-60")}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{item.studentName}</p>
                <p className="text-sm text-muted-foreground">
                  {item.teacherName || t("noTeacher")} · {te(`location.${item.location}`)}
                </p>
              </div>
              <StatusBadge status={item.status} />
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">{t("scheduledColumn")}</span>
              <span className="text-end tabular-nums" dir="ltr">
                {minToHHMM(item.startMin)}–{minToHHMM(item.startMin + item.hours * 60)}
              </span>
              <span className="text-muted-foreground">{t("checkInColumn")}</span>
              <span className="text-end tabular-nums" dir="ltr">{item.checkedInAt ?? "—"}</span>
              <span className="text-muted-foreground">{t("checkOutColumn")}</span>
              <span className="text-end tabular-nums" dir="ltr">{item.checkedOutAt ?? "—"}</span>
              <span className="text-muted-foreground">{t("actualColumn")}</span>
              <span className="text-end">
                {item.actualMinutes == null ? "—" : formatDurationClock(item.actualMinutes)}
              </span>
              <span className="text-muted-foreground">{t("billableColumn")}</span>
              <span className="text-end tabular-nums" dir="ltr">
                {formatDurationClock(item.billableMinutes)}
              </span>
              <span className="text-muted-foreground">{t("methodColumn")}</span>
              <span className="text-end">
                {item.checkInMethod ? te(`checkinMethod.${item.checkInMethod}`) : "—"}
              </span>
            </div>
            <SessionActions item={item} pending={pending} run={run} />
          </div>
        ))}
      </div>
      <TablePagination {...pg} />
    </div>
  );
}

export function RosterBoard({
  day,
  activeTab,
  activeView,
  items,
  pendingReview,
  needsTeacher,
  eligibleTeachersByDate,
}: {
  day: string;
  activeTab: AttendanceTab;
  activeView: AttendanceView;
  items: RosterItem[];
  pendingReview: RosterItem[];
  needsTeacher: RosterItem[];
  eligibleTeachersByDate: Record<string, { id: string; label: string }[]>;
}) {
  const t = useTranslations("checkin");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const [pending, start] = useTransition();
  const [scanOpen, setScanOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const attendanceSearch = useTableSearch(items, (i) => [i.studentName, i.teacherName]);
  const teacherSearch = useTableSearch(needsTeacher, (i) => [
    i.studentName,
    i.sessionDate,
  ]);
  const reviewSearch = useTableSearch(pendingReview, (i) => [
    i.studentName,
    i.teacherName,
    i.sessionDate,
  ]);
  const teacherPg = usePagination(teacherSearch.filtered, 20, teacherSearch.query);
  const reviewPg = usePagination(reviewSearch.filtered, 20, reviewSearch.query);

  const byTeacher = useMemo(() => {
    const grouped = new Map<string, RosterItem[]>();
    for (const item of attendanceSearch.filtered) {
      const key = item.teacherId ?? UNASSIGNED;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(item);
    }
    for (const list of grouped.values()) list.sort((a, b) => a.startMin - b.startMin);
    return [...grouped.entries()].sort((a, b) =>
      (a[1][0]?.teacherName ?? "").localeCompare(b[1][0]?.teacherName ?? "", locale),
    );
  }, [attendanceSearch.filtered, locale]);

  const decided = items.filter((i) => i.status === "COMPLETED" || i.status === "NO_SHOW");
  const awaiting = items.filter((i) => i.status === "SCHEDULED" || i.status === "CHECKED_IN");
  const hoursDone = decided
    .filter((i) => i.status === "COMPLETED")
    .reduce((sum, i) => sum + (i.actualMinutes == null ? i.hours : i.actualMinutes / 60), 0);

  function navigate(next: Partial<{ date: string; tab: AttendanceTab; view: AttendanceView }>) {
    const params = new URLSearchParams({
      date: next.date ?? day,
      tab: next.tab ?? activeTab,
      view: next.view ?? activeView,
    });
    router.push(`${pathname}?${params.toString()}`);
  }

  const run: ActionRunner = (fn) => {
    setActionError(null);
    start(async () => {
      const result = await fn();
      if (result.error) {
        setActionError(t(`actionErrors.${result.error}`));
        return;
      }
      router.refresh();
    });
  };

  const tabs: { key: AttendanceTab; label: string; count: number }[] = [
    { key: "attendance", label: t("tabAttendance"), count: items.length },
    { key: "needs-teacher", label: t("tabNeedsTeacher"), count: needsTeacher.length },
    { key: "review", label: t("tabReview"), count: pendingReview.length },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label={t("tabsLabel")}>
        {tabs.map((tab) => {
          const selected = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              id={`checkin-tab-${tab.key}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`checkin-panel-${tab.key}`}
              onClick={() => navigate({ tab: tab.key })}
              className={cn(
                "-mb-px inline-flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                selected
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              <Badge variant={selected ? "default" : "muted"} className="px-1.5 py-0 tabular-nums">
                {tab.count}
              </Badge>
            </button>
          );
        })}
      </div>

      {actionError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {actionError}
        </p>
      )}
      {flash && (
        <p className="rounded-md bg-success/15 px-3 py-2 text-sm text-[var(--success)]" role="status">
          {flash}
        </p>
      )}

      {activeTab === "attendance" && (
        <section
          id="checkin-panel-attendance"
          role="tabpanel"
          aria-labelledby="checkin-tab-attendance"
          className="space-y-3"
        >
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
            <Button variant="secondary" size="sm" onClick={() => navigate({ date: centerToday() })}>
              {t("today")}
            </Button>
            <div className="flex items-center">
              <Button variant="ghost" size="icon" aria-label={tc("prev")} onClick={() => navigate({ date: addDaysStr(day, -1) })}>
                <ChevronRight className="size-4 rtl:hidden" />
                <ChevronLeft className="hidden size-4 rtl:block" />
              </Button>
              <Button variant="ghost" size="icon" aria-label={tc("next")} onClick={() => navigate({ date: addDaysStr(day, 1) })}>
                <ChevronLeft className="size-4 rtl:hidden" />
                <ChevronRight className="hidden size-4 rtl:block" />
              </Button>
            </div>
            <Input
              type="date"
              dir="ltr"
              value={day}
              onChange={(e) => e.target.value && navigate({ date: e.target.value })}
              className="w-40"
            />
            <TableSearch
              value={attendanceSearch.query}
              onChange={attendanceSearch.setQuery}
              placeholder={t("searchPlaceholder")}
              className="min-w-48"
            />

            <div className="inline-flex rounded-md border border-input p-0.5" role="group" aria-label={t("viewLabel")}>
              <Button
                variant={activeView === "list" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 gap-1"
                aria-pressed={activeView === "list"}
                onClick={() => navigate({ view: "list" })}
              >
                <List className="size-3.5" /> {t("listView")}
              </Button>
              <Button
                variant={activeView === "cards" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 gap-1"
                aria-pressed={activeView === "cards"}
                onClick={() => navigate({ view: "cards" })}
              >
                <LayoutGrid className="size-3.5" /> {t("cardView")}
              </Button>
            </div>

            <div className="ms-auto flex flex-wrap items-center gap-2">
              <Badge variant="default">{t("awaiting", { n: awaiting.length })}</Badge>
              <Badge variant="success">{t("hoursRecorded", { h: formatHours(hoursDone) })}</Badge>
              <Button variant="secondary" size="sm" className="gap-1" onClick={() => setScanOpen(true)}>
                <QrCode className="size-4" /> {t("scan")}
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
                <Check className="size-4" /> {t("allPresentDay")}
              </Button>
            </div>
          </div>

          {activeView === "list" ? (
            <AttendanceList
              rows={attendanceSearch.filtered}
              query={attendanceSearch.query}
              pending={pending}
              run={run}
            />
          ) : (
            <div className="space-y-3">
              {byTeacher.length === 0 && (
                <p className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                  {tc("noData")}
                </p>
              )}
              {byTeacher.map(([teacherId, list]) => {
                const rowAwaiting = list.filter(
                  (item) => item.status === "SCHEDULED" || item.status === "CHECKED_IN",
                );
                return (
                  <div key={teacherId} className="rounded-lg border border-border bg-card p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{list[0]?.teacherName || t("noTeacher")}</span>
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
                          <Check className="size-3.5" /> {t("allPresent")}
                        </Button>
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {list.map((item) => (
                        <div
                          key={item.id}
                          className={cn(
                            "rounded-lg border-2 p-2 transition-colors",
                            CARD_STYLE[item.status] ?? CARD_STYLE.SCHEDULED,
                          )}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <span className="truncate font-medium">{item.studentName}</span>
                            {item.location === "HOME" ? (
                              <Home className="size-3.5 shrink-0" />
                            ) : (
                              <Building2 className="size-3.5 shrink-0 opacity-50" />
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="size-3" />
                            <span className="tabular-nums" dir="ltr">
                              {minToHHMM(item.startMin)}–{minToHHMM(item.startMin + item.hours * 60)}
                            </span>
                            {item.autoCompleted && (
                              <Badge variant="warning" className="ms-auto px-1 py-0 text-[10px]">
                                {t("autoTag")}
                              </Badge>
                            )}
                          </div>
                          {(item.checkedInAt || item.checkedOutAt) && (
                            <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                              {item.checkedInAt && <span>{t("checkedInAt", { time: item.checkedInAt })}</span>}
                              {item.checkedOutAt && <span>{t("checkedOutAt", { time: item.checkedOutAt })}</span>}
                            </div>
                          )}
                          <div className="mt-1 grid grid-cols-2 gap-1 text-[11px]">
                            <span className="text-muted-foreground">{t("actualColumn")}</span>
                            <span className="text-end tabular-nums" dir="ltr">
                              {item.actualMinutes == null ? "—" : formatDurationClock(item.actualMinutes)}
                            </span>
                            <span className="text-muted-foreground">{t("billableColumn")}</span>
                            <span className="text-end tabular-nums" dir="ltr">
                              {formatDurationClock(item.billableMinutes)}
                            </span>
                          </div>
                          <div className="mt-2">
                            <SessionActions item={item} pending={pending} run={run} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {activeTab === "needs-teacher" && (
        <section
          id="checkin-panel-needs-teacher"
          role="tabpanel"
          aria-labelledby="checkin-tab-needs-teacher"
          className="space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary bg-primary/5 p-3">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium">
              <UserPlus className="size-4" /> {t("needsTeacherTitle", { n: needsTeacher.length })}
            </span>
            <TableSearch
              value={teacherSearch.query}
              onChange={teacherSearch.setQuery}
              placeholder={t("searchQueue")}
              className="min-w-56 bg-background"
            />
          </div>
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tc("date")}</TableHead>
                  <TableHead>{t("studentColumn")}</TableHead>
                  <TableHead>{tc("status")}</TableHead>
                  <TableHead>{t("teacherAssignmentColumn")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teacherPg.pageItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-muted-foreground">{t("noNeedsTeacher")}</TableCell>
                  </TableRow>
                )}
                {teacherPg.pageItems.map((item) => {
                  const candidates = eligibleTeachersByDate[item.sessionDate] ?? [];
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="tabular-nums" dir="ltr">
                        {item.sessionDate} {minToHHMM(item.startMin)}
                      </TableCell>
                      <TableCell className="font-medium">{item.studentName}</TableCell>
                      <TableCell><StatusBadge status={item.status} /></TableCell>
                      <TableCell>
                        <div className="flex flex-col items-center gap-1">
                          <Select
                            aria-label={t("assignTeacher")}
                            className="w-52"
                            defaultValue=""
                            disabled={pending || candidates.length === 0}
                            onChange={(e) =>
                              e.target.value &&
                              run(() =>
                                assignSessionTeacher(locale, {
                                  sessionId: item.id,
                                  teacherId: e.target.value,
                                }),
                              )
                            }
                          >
                            <option value="">{t("assignTeacher")}</option>
                            {candidates.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
                            ))}
                          </Select>
                          {candidates.length === 0 && (
                            <span className="text-xs text-muted-foreground">{t("noEligibleTeachers")}</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <TablePagination {...teacherPg} />
          </div>
        </section>
      )}

      {activeTab === "review" && (
        <section
          id="checkin-panel-review"
          role="tabpanel"
          aria-labelledby="checkin-tab-review"
          className="space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning bg-warning/10 p-3">
            <div>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                <AlertTriangle className="size-4" /> {t("reviewTitle", { n: pendingReview.length })}
              </span>
              <p className="mt-1 text-xs text-muted-foreground">{t("reviewHint")}</p>
            </div>
            <TableSearch
              value={reviewSearch.query}
              onChange={reviewSearch.setQuery}
              placeholder={t("searchQueue")}
              className="min-w-56 bg-background"
            />
          </div>
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tc("date")}</TableHead>
                  <TableHead>{t("studentColumn")}</TableHead>
                  <TableHead>{t("teacherColumn")}</TableHead>
                  <TableHead>{tc("status")}</TableHead>
                  <TableHead>{t("actionsColumn")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviewPg.pageItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-muted-foreground">{t("noReviewSessions")}</TableCell>
                  </TableRow>
                )}
                {reviewPg.pageItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="tabular-nums" dir="ltr">
                      {item.sessionDate} {minToHHMM(item.startMin)}
                    </TableCell>
                    <TableCell className="font-medium">{item.studentName}</TableCell>
                    <TableCell>{item.teacherName || t("noTeacher")}</TableCell>
                    <TableCell><StatusBadge status={item.status} /></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-center gap-1">
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() => run(() => confirmAutoComplete(locale, item.id))}
                        >
                          {t("accept")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1"
                          disabled={pending}
                          onClick={() => run(() => undoAutoComplete(locale, item.id))}
                        >
                          <Undo2 className="size-3.5" /> {t("undo")}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination {...reviewPg} />
          </div>
        </section>
      )}

      {scanOpen && (
        <QrScanner
          day={day}
          onClose={() => setScanOpen(false)}
          onResult={(message) => {
            setFlash(message);
            router.refresh();
            setTimeout(() => setFlash(null), 4000);
          }}
        />
      )}
    </div>
  );
}
