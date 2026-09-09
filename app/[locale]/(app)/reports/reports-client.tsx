"use client";

import { useLocale, useTranslations } from "next-intl";
import { Ban, CalendarDays, Download, Users, UsersRound } from "lucide-react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PrintButton } from "@/components/print-button";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DailySessionsChart } from "@/components/charts/daily-sessions-chart";
import { formatMoney, formatHours } from "@/lib/money";
import { formatDateOnly } from "@/lib/date-only";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import type {
  AttendanceRow,
  RevenueRow,
  CollectionsRow,
  PackageReportRow,
  PayoutSummaryRow,
  DebtorRow,
} from "@/lib/report-queries";
import type { DailySessionReport } from "@/lib/session-operational-report";

export type ReportTab = "daily-sessions" | "attendance" | "revenue" | "collections" | "packages" | "payroll" | "debtors";

const TABS: ReportTab[] = ["daily-sessions", "attendance", "revenue", "collections", "packages", "payroll", "debtors"];

/** Which grouping options each report offers, if any. */
const GROUPINGS: Partial<Record<ReportTab, string[]>> = {
  attendance: ["teacher", "student"],
  revenue: ["teacher", "level", "location"],
};

export function ReportsClient({
  tab,
  groupBy,
  filter,
  terms,
  currency,
  centerName,
  defaultPrintFormat,
  periodLabel,
  dailySessions,
  attendance,
  revenue,
  collections,
  packages,
  payouts,
  debtors,
}: {
  tab: ReportTab;
  groupBy: string;
  filter: { from: string; to: string; term: string };
  terms: { id: string; label: string }[];
  currency: string;
  centerName: string;
  defaultPrintFormat: string;
  periodLabel: string;
  dailySessions?: DailySessionReport;
  attendance?: AttendanceRow[];
  revenue?: RevenueRow[];
  collections?: CollectionsRow[];
  packages?: PackageReportRow[];
  payouts?: PayoutSummaryRow[];
  debtors?: DebtorRow[];
}) {
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function go(params: Record<string, string>) {
    const sp = new URLSearchParams({ tab, ...filter, ...params });
    for (const [k, v] of [...sp.entries()]) if (!v) sp.delete(k);
    router.push(`${pathname}?${sp.toString()}`);
  }

  const groupings = GROUPINGS[tab];
  const exportUrl = `/api/reports/${tab}?${new URLSearchParams({
    locale,
    ...(groupBy ? { by: groupBy } : {}),
    ...(filter.from ? { from: filter.from } : {}),
    ...(filter.to ? { to: filter.to } : {}),
    ...(filter.term ? { term: filter.term } : {}),
  }).toString()}`;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-2">
        <div
          role="tablist"
          aria-label={t("reportTabs")}
          className="flex flex-wrap items-center gap-1 rounded-md border border-border p-0.5"
        >
          {TABS.map((x) => (
            <button
              type="button"
              role="tab"
              aria-selected={x === tab}
              key={x}
              onClick={() => go({ tab: x, by: "" })}
              className={
                x === tab
                  ? "rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
                  : "rounded px-3 py-1 text-sm text-muted-foreground hover:bg-accent"
              }
            >
              {t(`tabs.${x}`)}
            </button>
          ))}
        </div>

        {groupings && (
          <Select
            aria-label={t("groupBy")}
            className="w-40"
            value={groupBy || groupings[0]}
            onChange={(e) => go({ by: e.target.value })}
          >
            {groupings.map((g) => (
              <option key={g} value={g}>{t(`groupings.${g}`)}</option>
            ))}
          </Select>
        )}

        <div className="ms-auto flex flex-wrap items-end gap-2">
          <Select
            aria-label={t("term")}
            className="w-40"
            value={filter.term}
            onChange={(e) => go({ term: e.target.value, from: "", to: "" })}
          >
            <option value="">{t("customRange")}</option>
            {terms.map((x) => (
              <option key={x.id} value={x.id}>{x.label}</option>
            ))}
          </Select>
          <Input
            type="date"
            dir="ltr"
            className="w-40"
            aria-label={tc("from")}
            value={filter.from}
            disabled={!!filter.term}
            onChange={(e) => go({ from: e.target.value, term: "" })}
          />
          <Input
            type="date"
            dir="ltr"
            className="w-40"
            aria-label={tc("to")}
            value={filter.to}
            disabled={!!filter.term}
            onChange={(e) => go({ to: e.target.value, term: "" })}
          />
          <Button variant="secondary" size="sm" className="gap-1" asChild>
            <a href={exportUrl}>
              <Download className="size-4" />
              {t("exportExcel")}
            </a>
          </Button>
          <PrintButton defaultFormat={defaultPrintFormat} />
        </div>
      </div>

      {/* Print header — the toolbar is hidden on paper, so the report has to
          say what it is and which period it covers. */}
      <div className="hidden print:mb-3 print:block print:text-center">
        <div className="font-bold">{centerName}</div>
        <div className="text-sm">
          {t(`tabs.${tab}`)} · <span dir="ltr">{periodLabel}</span>
        </div>
      </div>

      <div data-print="A4" data-print-size-selectable className="rounded-lg border border-border bg-card">
        {tab === "daily-sessions" && dailySessions && (
          <DailySessionsReport report={dailySessions} />
        )}
        {tab === "attendance" && attendance && (
          <AttendanceTable rows={attendance} />
        )}
        {tab === "revenue" && revenue && <RevenueTable rows={revenue} currency={currency} te={te} />}
        {tab === "collections" && collections && (
          <CollectionsTable rows={collections} currency={currency} />
        )}
        {tab === "packages" && packages && <PackagesTable rows={packages} currency={currency} />}
        {tab === "payroll" && payouts && <PayoutsSummaryTable rows={payouts} currency={currency} />}
        {tab === "debtors" && debtors && <DebtorsTable rows={debtors} currency={currency} />}
      </div>
    </div>
  );
}

/* ---------------- tables ---------------- */

function DailySessionsReport({ report }: { report: DailySessionReport }) {
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const days = report.dailyTrend.length;
  const average = days > 0 ? report.summary.sessions / days : 0;
  const p = usePagination(report.dailyTrend);
  const numberFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const hasActivity = report.summary.sessions + report.summary.cancelledSessions > 0;
  const hasActiveActivity = report.summary.sessions > 0;

  return (
    <div className="space-y-4 p-3 sm:p-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label={t("teachingSessions")}
          value={numberFormatter.format(report.summary.sessions)}
          icon={CalendarDays}
          tone="primary"
        />
        <StatCard
          label={t("averagePerDay")}
          value={numberFormatter.format(average)}
          icon={CalendarDays}
          hint={t("calendarDays", { count: days })}
        />
        <StatCard
          label={t("studentBookings")}
          value={numberFormatter.format(report.summary.studentBookings)}
          icon={Users}
        />
        <StatCard
          label={t("groupSessions")}
          value={numberFormatter.format(report.summary.groupSessions)}
          icon={UsersRound}
          hint={t("individualSessionsHint", { count: report.summary.individualSessions })}
        />
        <StatCard
          label={t("cancelledSessions")}
          value={numberFormatter.format(report.summary.cancelledSessions)}
          icon={Ban}
          tone={report.summary.cancelledSessions > 0 ? "destructive" : "default"}
          hint={t("cancelledStudentsHint", { count: report.summary.cancelledStudentBookings })}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("dailySessionTrend")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("dailySessionTrendHint")}</p>
        </CardHeader>
        <CardContent>
          {hasActiveActivity ? (
            <DailySessionsChart
              data={report.dailyTrend}
              labels={{
                sessions: t("teachingSessions"),
                studentBookings: t("studentBookings"),
                ariaLabel: t("dailySessionChartAria"),
              }}
            />
          ) : (
            <Empty />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("dailyDetails")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!hasActivity ? (
            <Empty />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-y border-border bg-muted/40">
                      <Th>{tc("date")}</Th>
                      <Th>{t("teachingSessions")}</Th>
                      <Th>{t("groupSessions")}</Th>
                      <Th>{t("individualSessions")}</Th>
                      <Th>{t("studentBookings")}</Th>
                      <Th>{t("scheduled")}</Th>
                      <Th>{t("checkedIn")}</Th>
                      <Th>{t("completed")}</Th>
                      <Th>{t("noShow")}</Th>
                      <Th>{t("cancelledSessions")}</Th>
                      <Th>{t("cancelledStudentBookings")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.pageItems.map((row) => (
                      <tr key={row.date} className="border-b border-border/60">
                        <td className="whitespace-nowrap p-2 text-center tabular-nums" dir="ltr">
                          {formatDateOnly(row.date)}
                        </td>
                        <td className="p-2 text-center font-medium tabular-nums">{row.sessions}</td>
                        <td className="p-2 text-center tabular-nums">{row.groupSessions}</td>
                        <td className="p-2 text-center tabular-nums">{row.individualSessions}</td>
                        <td className="p-2 text-center tabular-nums">{row.studentBookings}</td>
                        <td className="p-2 text-center tabular-nums">{row.scheduled}</td>
                        <td className="p-2 text-center tabular-nums">{row.checkedIn}</td>
                        <td className="p-2 text-center tabular-nums">{row.completed}</td>
                        <td className="p-2 text-center tabular-nums">{row.noShow}</td>
                        <td className="p-2 text-center tabular-nums text-destructive">{row.cancelled}</td>
                        <td className="p-2 text-center tabular-nums text-destructive">{row.cancelledStudentBookings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <TablePagination {...p} />
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{t("teacherWorkload")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {report.teacherWorkload.length === 0 ? (
              <Empty />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-y border-border bg-muted/40">
                      <Th>{tc("name")}</Th>
                      <Th>{t("teachingSessions")}</Th>
                      <Th>{t("studentBookings")}</Th>
                      <Th>{t("plannedHours")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.teacherWorkload.map((row) => (
                      <tr key={row.teacherId ?? "unassigned"} className="border-b border-border/60">
                        <td className="p-2 text-center">{row.teacherName ?? t("unassignedTeacher")}</td>
                        <td className="p-2 text-center tabular-nums">{row.sessions}</td>
                        <td className="p-2 text-center tabular-nums">{row.studentBookings}</td>
                        <td className="p-2 text-center tabular-nums">{formatHours(row.plannedHours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("statusBreakdown")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {report.statusBreakdown.length === 0 ? (
              <Empty />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-y border-border bg-muted/40">
                      <Th>{tc("status")}</Th>
                      <Th>{t("teachingOccurrences")}</Th>
                      <Th>{t("studentOutcomes")}</Th>
                      <Th>{t("share")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.statusBreakdown.map((row) => (
                      <tr key={row.status} className="border-b border-border/60">
                        <td className="p-2 text-center">
                          {te(`sessionStatus.${row.status as "SCHEDULED"}`)}
                        </td>
                        <td className="p-2 text-center tabular-nums">{row.sessions}</td>
                        <td className="p-2 text-center tabular-nums">{row.studentBookings}</td>
                        <td className="p-2 text-center tabular-nums">{row.studentBookingPercentage}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("sessionMix")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-y border-border bg-muted/40">
                    <Th>{t("bookingType")}</Th>
                    <Th>{t("teachingSessions")}</Th>
                    <Th>{t("studentBookings")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.bookingTypes.map((row) => (
                    <tr key={row.type} className="border-b border-border/60">
                      <td className="p-2 text-center">
                        {row.type === "GROUP" ? t("groupSessions") : t("individualSessions")}
                      </td>
                      <td className="p-2 text-center tabular-nums">{row.sessions}</td>
                      <td className="p-2 text-center tabular-nums">{row.studentBookings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto pb-4">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-y border-border bg-muted/40">
                    <Th>{t("location")}</Th>
                    <Th>{t("teachingSessions")}</Th>
                    <Th>{t("plannedHours")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.locations.map((row) => (
                    <tr key={row.location} className="border-b border-border/60">
                      <td className="p-2 text-center">
                        {te(`location.${row.location as "CENTER"}`)}
                      </td>
                      <td className="p-2 text-center tabular-nums">{row.sessions}</td>
                      <td className="p-2 text-center tabular-nums">{formatHours(row.plannedHours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Empty() {
  const tc = useTranslations("common");
  return <p className="p-6 text-center text-sm text-muted-foreground">{tc("noData")}</p>;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="p-2 text-center font-medium">{children}</th>
  );
}

function CollectionsTable({ rows, currency }: { rows: CollectionsRow[]; currency: string }) {
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  if (rows.length === 0) return <Empty />;

  const totals = rows.reduce(
    (a, r) => ({
      count: a.count + r.count,
      refundCount: a.refundCount + r.refundCount,
      gross: a.gross + r.gross,
      refunded: a.refunded + r.refunded,
      total: a.total + r.total,
    }),
    { count: 0, refundCount: 0, gross: 0, refunded: 0, total: 0 },
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <Th>{t("method")}</Th>
            <Th>{t("paymentsCount")}</Th>
            <Th>{t("grossCollected")}</Th>
            <Th>{t("refunds")}</Th>
            <Th>{t("netCollected")}</Th>
            <Th>{t("share")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.method} className="border-b border-border/60">
              <td className="p-2 text-center">{te(`method.${r.method as "CASH"}`)}</td>
              <td className="p-2 text-center tabular-nums">{r.count}</td>
              <td className="p-2 text-center tabular-nums">
                <span dir="ltr">
                  {formatMoney(r.gross)} {currency}
                </span>
              </td>
              <td className="p-2 text-center tabular-nums text-destructive">
                <span dir="ltr" title={t("refundsCount", { count: r.refundCount })}>
                  {formatMoney(r.refunded)} {currency}
                </span>
              </td>
              <td className="p-2 text-center font-medium tabular-nums">
                <span dir="ltr">
                  {formatMoney(r.total)} {currency}
                </span>
              </td>
              <td className="p-2 text-center tabular-nums">
                <Badge variant="default">{r.pct}%</Badge>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-semibold">
            <td className="p-2 text-center">{tc("total")}</td>
            <td className="p-2 text-center tabular-nums">{totals.count}</td>
            <td className="p-2 text-center tabular-nums">
              <span dir="ltr">
                {formatMoney(totals.gross)} {currency}
              </span>
            </td>
            <td className="p-2 text-center tabular-nums text-destructive">
              <span dir="ltr" title={t("refundsCount", { count: totals.refundCount })}>
                {formatMoney(totals.refunded)} {currency}
              </span>
            </td>
            <td className="p-2 text-center tabular-nums">
              <span dir="ltr">
                {formatMoney(totals.total)} {currency}
              </span>
            </td>
            <td className="p-2 text-center tabular-nums">100%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function AttendanceTable({ rows }: { rows: AttendanceRow[] }) {
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const p = usePagination(rows);
  if (rows.length === 0) return <Empty />;

  const totals = rows.reduce(
    (a, r) => ({
      total: a.total + r.total,
      completed: a.completed + r.completed,
      noShow: a.noShow + r.noShow,
      cancelled: a.cancelled + r.cancelled,
      hours: a.hours + r.hours,
    }),
    { total: 0, completed: 0, noShow: 0, cancelled: 0, hours: 0 },
  );

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <Th>{tc("name")}</Th>
              <Th>{t("sessionsCount")}</Th>
              <Th>{t("completed")}</Th>
              <Th>{t("noShow")}</Th>
              <Th>{t("cancelled")}</Th>
              <Th>{tc("hours")}</Th>
              <Th>{t("attendanceRate")}</Th>
            </tr>
          </thead>
          <tbody>
            {p.pageItems.map((r) => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="p-2 text-center">{r.name}</td>
                <td className="p-2 text-center tabular-nums">{r.total}</td>
                <td className="p-2 text-center tabular-nums">{r.completed}</td>
                <td className="p-2 text-center tabular-nums">{r.noShow}</td>
                <td className="p-2 text-center tabular-nums">{r.cancelled}</td>
                <td className="p-2 text-center tabular-nums">{formatHours(r.hours)}</td>
                <td className="p-2 text-center tabular-nums">
                  <Badge variant={r.attendanceRate >= 90 ? "success" : r.attendanceRate >= 75 ? "warning" : "destructive"}>
                    {r.attendanceRate}%
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="p-2 text-center">{tc("total")}</td>
              <td className="p-2 text-center tabular-nums">{totals.total}</td>
              <td className="p-2 text-center tabular-nums">{totals.completed}</td>
              <td className="p-2 text-center tabular-nums">{totals.noShow}</td>
              <td className="p-2 text-center tabular-nums">{totals.cancelled}</td>
              <td className="p-2 text-center tabular-nums">{formatHours(totals.hours)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <TablePagination {...p} />
    </>
  );
}

function RevenueTable({
  rows,
  currency,
  te,
}: {
  rows: RevenueRow[];
  currency: string;
  te: ReturnType<typeof useTranslations>;
}) {
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const p = usePagination(rows);
  if (rows.length === 0) return <Empty />;

  const total = rows.reduce((a, r) => a + r.expected, 0);
  const hours = rows.reduce((a, r) => a + r.hours, 0);
  // Location rows carry an enum key rather than a display name.
  const label = (r: RevenueRow) =>
    r.label === "CENTER" || r.label === "HOME" ? te(`location.${r.label}`) : r.label;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <Th>{tc("name")}</Th>
              <Th>{t("sessionsCount")}</Th>
              <Th>{tc("hours")}</Th>
              <Th>{t("expectedRevenue")}</Th>
              <Th>{t("share")}</Th>
            </tr>
          </thead>
          <tbody>
            {p.pageItems.map((r) => (
              <tr key={r.key} className="border-b border-border/60">
                <td className="p-2 text-center">{label(r)}</td>
                <td className="p-2 text-center tabular-nums">{r.sessions}</td>
                <td className="p-2 text-center tabular-nums">{formatHours(r.hours)}</td>
                <td className="p-2 text-center tabular-nums">{formatMoney(r.expected)} {currency}</td>
                <td className="p-2 text-center tabular-nums">
                  {total > 0 ? Math.round((r.expected / total) * 100) : 0}%
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="p-2 text-center">{tc("total")}</td>
              <td className="p-2 text-center tabular-nums">
                {rows.reduce((a, r) => a + r.sessions, 0)}
              </td>
              <td className="p-2 text-center tabular-nums">{formatHours(hours)}</td>
              <td className="p-2 text-center tabular-nums">{formatMoney(total)} {currency}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <TablePagination {...p} />
    </>
  );
}

function PackagesTable({ rows, currency }: { rows: PackageReportRow[]; currency: string }) {
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const p = usePagination(rows);
  if (rows.length === 0) return <Empty />;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <Th>{tc("name")}</Th>
              <Th>{t("totalHours")}</Th>
              <Th>{t("hoursUsed")}</Th>
              <Th>{t("remaining")}</Th>
              <Th>{tc("price")}</Th>
              <Th>{tc("status")}</Th>
              <Th>{t("expiresAt")}</Th>
            </tr>
          </thead>
          <tbody>
            {p.pageItems.map((r) => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="p-2 text-center">{r.studentName}</td>
                <td className="p-2 text-center tabular-nums">{formatHours(r.totalHours)}</td>
                <td className="p-2 text-center tabular-nums">{formatHours(r.hoursUsed)}</td>
                <td className="p-2 text-center tabular-nums">{formatHours(r.remaining)}</td>
                <td className="p-2 text-center tabular-nums">{formatMoney(r.price)} {currency}</td>
                <td className="p-2 text-center">
                  <Badge variant={r.status === "ACTIVE" ? "success" : "default"}>
                    {te(`packageStatus.${r.status}`)}
                  </Badge>
                </td>
                <td className="p-2 text-center tabular-nums"><span dir="ltr">{formatDateOnly(r.expiresAt)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TablePagination {...p} />
    </>
  );
}

function PayoutsSummaryTable({ rows, currency }: { rows: PayoutSummaryRow[]; currency: string }) {
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const tm = useTranslations("paymentModes");
  const p = usePagination(rows);
  if (rows.length === 0) return <Empty />;

  const net = rows.reduce((a, r) => a + r.netPaid, 0);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <Th>{tc("name")}</Th>
              <Th>{t("payMode")}</Th>
              <Th>{t("period")}</Th>
              <Th>{t("commission")}</Th>
              <Th>{t("fixedSalary")}</Th>
              <Th>{t("deductions")}</Th>
              <Th>{t("netPaid")}</Th>
            </tr>
          </thead>
          <tbody>
            {p.pageItems.map((r) => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="p-2 text-center">{r.teacherName}</td>
                <td className="p-2 text-center">
                  {r.payMode ? <Badge>{tm(r.payMode as "MONTH")}</Badge> : "—"}
                </td>
                <td className="p-2 text-center tabular-nums">
                  <span dir="ltr">
                    {formatDateOnly(r.periodStart)} → {formatDateOnly(r.periodEnd)}
                  </span>
                </td>
                <td className="p-2 text-center tabular-nums">{formatMoney(r.grossCommission)}</td>
                <td className="p-2 text-center tabular-nums">{formatMoney(r.fixedSalary)}</td>
                <td className="p-2 text-center tabular-nums">{formatMoney(r.deductions + r.advances)}</td>
                <td className="p-2 text-center font-semibold tabular-nums">
                  {formatMoney(r.netPaid)} {currency}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="p-2 text-center" colSpan={6}>{tc("total")}</td>
              <td className="p-2 text-center tabular-nums">{formatMoney(net)} {currency}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <TablePagination {...p} />
    </>
  );
}

function DebtorsTable({ rows, currency }: { rows: DebtorRow[]; currency: string }) {
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const p = usePagination(rows);
  if (rows.length === 0) return <Empty />;

  const total = rows.reduce((a, r) => a + r.balance, 0);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <Th>{tc("name")}</Th>
              <Th>{t("guardian")}</Th>
              <Th>{tc("phone")}</Th>
              <Th>{t("charges")}</Th>
              <Th>{t("paid")}</Th>
              <Th>{t("balance")}</Th>
            </tr>
          </thead>
          <tbody>
            {p.pageItems.map((r) => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="p-2 text-center">{r.name}</td>
                <td className="p-2 text-center">{r.guardianName ?? "—"}</td>
                <td className="p-2 text-center tabular-nums"><span dir="ltr">{r.phone ?? "—"}</span></td>
                <td className="p-2 text-center tabular-nums">{formatMoney(r.charges)}</td>
                <td className="p-2 text-center tabular-nums">{formatMoney(r.paid)}</td>
                <td className="p-2 text-center font-semibold tabular-nums text-destructive">
                  {formatMoney(r.balance)} {currency}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="p-2 text-center" colSpan={5}>{tc("total")}</td>
              <td className="p-2 text-center tabular-nums">{formatMoney(total)} {currency}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <TablePagination {...p} />
    </>
  );
}
