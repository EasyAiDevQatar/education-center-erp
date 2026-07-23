"use client";

import { useTranslations } from "next-intl";
import { Printer, Download } from "lucide-react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatHours } from "@/lib/money";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import type {
  AttendanceRow,
  RevenueRow,
  CollectionsRow,
  PackageReportRow,
  PayoutSummaryRow,
  DebtorRow,
} from "@/lib/report-queries";

export type ReportTab = "attendance" | "revenue" | "collections" | "packages" | "payroll" | "debtors";

const TABS: ReportTab[] = ["attendance", "revenue", "collections", "packages", "payroll", "debtors"];

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
  periodLabel,
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
  periodLabel: string;
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
  const router = useRouter();
  const pathname = usePathname();

  function go(params: Record<string, string>) {
    const sp = new URLSearchParams({ tab, ...filter, ...params });
    for (const [k, v] of [...sp.entries()]) if (!v) sp.delete(k);
    router.push(`${pathname}?${sp.toString()}`);
  }

  const groupings = GROUPINGS[tab];
  const exportUrl = `/api/reports/${tab}?${new URLSearchParams({
    ...(groupBy ? { by: groupBy } : {}),
    ...(filter.from ? { from: filter.from } : {}),
    ...(filter.to ? { to: filter.to } : {}),
    ...(filter.term ? { term: filter.term } : {}),
  }).toString()}`;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-2">
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-border p-0.5">
          {TABS.map((x) => (
            <button
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
          <Button variant="secondary" size="sm" className="gap-1" onClick={() => window.print()}>
            <Printer className="size-4" />
            {tc("print")}
          </Button>
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

      <div data-print="A4" className="rounded-lg border border-border bg-card">
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

function Empty() {
  const tc = useTranslations("common");
  return <p className="p-6 text-center text-sm text-muted-foreground">{tc("noData")}</p>;
}

function Th({ children, end }: { children: React.ReactNode; end?: boolean }) {
  return (
    <th className={`p-2 ${end ? "text-end" : "text-start"} font-medium`}>{children}</th>
  );
}

function CollectionsTable({ rows, currency }: { rows: CollectionsRow[]; currency: string }) {
  const t = useTranslations("reports");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  if (rows.length === 0) return <Empty />;

  const totals = rows.reduce(
    (a, r) => ({ count: a.count + r.count, total: a.total + r.total }),
    { count: 0, total: 0 },
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <Th>{t("method")}</Th>
            <Th end>{t("paymentsCount")}</Th>
            <Th end>{tc("amount")}</Th>
            <Th end>{t("share")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.method} className="border-b border-border/60">
              <td className="p-2">{te(`method.${r.method as "CASH"}`)}</td>
              <td className="p-2 text-end tabular-nums">{r.count}</td>
              <td className="p-2 text-end tabular-nums" dir="ltr">
                {formatMoney(r.total)} {currency}
              </td>
              <td className="p-2 text-end tabular-nums">
                <Badge variant="default">{r.pct}%</Badge>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border font-semibold">
            <td className="p-2">{tc("total")}</td>
            <td className="p-2 text-end tabular-nums">{totals.count}</td>
            <td className="p-2 text-end tabular-nums" dir="ltr">
              {formatMoney(totals.total)} {currency}
            </td>
            <td className="p-2 text-end tabular-nums">100%</td>
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
              <Th end>{t("sessionsCount")}</Th>
              <Th end>{t("completed")}</Th>
              <Th end>{t("noShow")}</Th>
              <Th end>{t("cancelled")}</Th>
              <Th end>{tc("hours")}</Th>
              <Th end>{t("attendanceRate")}</Th>
            </tr>
          </thead>
          <tbody>
            {p.pageItems.map((r) => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="p-2">{r.name}</td>
                <td className="p-2 text-end tabular-nums">{r.total}</td>
                <td className="p-2 text-end tabular-nums">{r.completed}</td>
                <td className="p-2 text-end tabular-nums">{r.noShow}</td>
                <td className="p-2 text-end tabular-nums">{r.cancelled}</td>
                <td className="p-2 text-end tabular-nums">{formatHours(r.hours)}</td>
                <td className="p-2 text-end tabular-nums">
                  <Badge variant={r.attendanceRate >= 90 ? "success" : r.attendanceRate >= 75 ? "warning" : "destructive"}>
                    {r.attendanceRate}%
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="p-2">{tc("total")}</td>
              <td className="p-2 text-end tabular-nums">{totals.total}</td>
              <td className="p-2 text-end tabular-nums">{totals.completed}</td>
              <td className="p-2 text-end tabular-nums">{totals.noShow}</td>
              <td className="p-2 text-end tabular-nums">{totals.cancelled}</td>
              <td className="p-2 text-end tabular-nums">{formatHours(totals.hours)}</td>
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
              <Th end>{t("sessionsCount")}</Th>
              <Th end>{tc("hours")}</Th>
              <Th end>{t("expectedRevenue")}</Th>
              <Th end>{t("share")}</Th>
            </tr>
          </thead>
          <tbody>
            {p.pageItems.map((r) => (
              <tr key={r.key} className="border-b border-border/60">
                <td className="p-2">{label(r)}</td>
                <td className="p-2 text-end tabular-nums">{r.sessions}</td>
                <td className="p-2 text-end tabular-nums">{formatHours(r.hours)}</td>
                <td className="p-2 text-end tabular-nums">{formatMoney(r.expected)} {currency}</td>
                <td className="p-2 text-end tabular-nums">
                  {total > 0 ? Math.round((r.expected / total) * 100) : 0}%
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="p-2">{tc("total")}</td>
              <td className="p-2 text-end tabular-nums">
                {rows.reduce((a, r) => a + r.sessions, 0)}
              </td>
              <td className="p-2 text-end tabular-nums">{formatHours(hours)}</td>
              <td className="p-2 text-end tabular-nums">{formatMoney(total)} {currency}</td>
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
              <Th end>{t("totalHours")}</Th>
              <Th end>{t("hoursUsed")}</Th>
              <Th end>{t("remaining")}</Th>
              <Th end>{tc("price")}</Th>
              <Th>{tc("status")}</Th>
              <Th>{t("expiresAt")}</Th>
            </tr>
          </thead>
          <tbody>
            {p.pageItems.map((r) => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="p-2">{r.studentName}</td>
                <td className="p-2 text-end tabular-nums">{formatHours(r.totalHours)}</td>
                <td className="p-2 text-end tabular-nums">{formatHours(r.hoursUsed)}</td>
                <td className="p-2 text-end tabular-nums">{formatHours(r.remaining)}</td>
                <td className="p-2 text-end tabular-nums">{formatMoney(r.price)} {currency}</td>
                <td className="p-2">
                  <Badge variant={r.status === "ACTIVE" ? "success" : "default"}>
                    {te(`packageStatus.${r.status}`)}
                  </Badge>
                </td>
                <td className="p-2 tabular-nums" dir="ltr">{r.expiresAt ?? "—"}</td>
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
              <Th end>{t("commission")}</Th>
              <Th end>{t("fixedSalary")}</Th>
              <Th end>{t("deductions")}</Th>
              <Th end>{t("netPaid")}</Th>
            </tr>
          </thead>
          <tbody>
            {p.pageItems.map((r) => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="p-2">{r.teacherName}</td>
                <td className="p-2">
                  {r.payMode ? <Badge>{tm(r.payMode as "MONTH")}</Badge> : "—"}
                </td>
                <td className="p-2 tabular-nums" dir="ltr">
                  {r.periodStart} → {r.periodEnd}
                </td>
                <td className="p-2 text-end tabular-nums">{formatMoney(r.grossCommission)}</td>
                <td className="p-2 text-end tabular-nums">{formatMoney(r.fixedSalary)}</td>
                <td className="p-2 text-end tabular-nums">{formatMoney(r.deductions + r.advances)}</td>
                <td className="p-2 text-end font-semibold tabular-nums">
                  {formatMoney(r.netPaid)} {currency}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="p-2" colSpan={6}>{tc("total")}</td>
              <td className="p-2 text-end tabular-nums">{formatMoney(net)} {currency}</td>
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
              <Th end>{t("charges")}</Th>
              <Th end>{t("paid")}</Th>
              <Th end>{t("balance")}</Th>
            </tr>
          </thead>
          <tbody>
            {p.pageItems.map((r) => (
              <tr key={r.id} className="border-b border-border/60">
                <td className="p-2">{r.name}</td>
                <td className="p-2">{r.guardianName ?? "—"}</td>
                <td className="p-2 tabular-nums" dir="ltr">{r.phone ?? "—"}</td>
                <td className="p-2 text-end tabular-nums">{formatMoney(r.charges)}</td>
                <td className="p-2 text-end tabular-nums">{formatMoney(r.paid)}</td>
                <td className="p-2 text-end font-semibold tabular-nums text-destructive">
                  {formatMoney(r.balance)} {currency}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="p-2" colSpan={5}>{tc("total")}</td>
              <td className="p-2 text-end tabular-nums">{formatMoney(total)} {currency}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <TablePagination {...p} />
    </>
  );
}
