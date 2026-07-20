"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePagination, TablePagination } from "@/components/ui/table-pagination";
import { TableSearch, useTableSearch } from "@/components/ui/table-search";
import { formatMoney, formatHours } from "@/lib/money";
import { QuickPayDialog } from "../../payments/quick-pay-dialog";
import type { SessionLine } from "@/components/tables/relation-tables";

const SESSION_STATUS_VARIANT: Record<string, "success" | "warning" | "muted" | "destructive"> = {
  COMPLETED: "success",
  CHECKED_IN: "warning",
  DRAFT: "warning",
  SCHEDULED: "muted",
  NO_SHOW: "destructive",
  CANCELLED: "muted",
};

function payVariant(s: string) {
  if (s === "PAID") return "success" as const;
  if (s === "PARTIAL") return "warning" as const;
  return "muted" as const;
}

/**
 * The student's session history with per-row and bulk payment.
 *
 * Only unpaid, non-draft sessions are selectable — a draft isn't billable yet
 * and a paid one has nothing left to settle, so offering either would produce
 * a payment that doesn't correspond to a debt.
 */
export function StudentSessionsTable({
  rows,
  currency,
  studentId,
  studentName,
  teachers,
}: {
  rows: SessionLine[];
  currency: string;
  studentId: string;
  studentName: string;
  teachers: { id: string; label: string }[];
}) {
  const t = useTranslations("sessions");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const tp = useTranslations("payments");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const search = useTableSearch(rows, (r) => [r.teacherName, r.levelLabel, r.date, r.status]);
  const pg = usePagination(search.filtered);

  const payable = (r: SessionLine) => r.paymentStatus !== "PAID" && r.status !== "DRAFT" && r.status !== "CANCELLED";

  const selectablePageIds = pg.pageItems.filter(payable).map((r) => r.id);
  const allPageSelected =
    selectablePageIds.length > 0 && selectablePageIds.every((id) => selected.has(id));

  const selectedTotal = useMemo(
    () => rows.filter((r) => selected.has(r.id)).reduce((sum, r) => sum + r.total, 0),
    [rows, selected],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) selectablePageIds.forEach((id) => next.delete(id));
      else selectablePageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TableSearch
          value={search.query}
          onChange={search.setQuery}
          resultCount={search.filtered.length}
          placeholder={t("searchPlaceholder")}
        />
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <span className="text-sm text-muted-foreground">
              {tp("selectedCount", { n: selected.size })} ·{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {formatMoney(selectedTotal)} {currency}
              </span>
            </span>
          )}
          <QuickPayDialog
            studentId={studentId}
            studentName={studentName}
            amount={selectedTotal}
            currency={currency}
            teachers={teachers}
            variant="button"
            label={tp("paySelected")}
            disabled={selected.size === 0}
            onPaid={() => setSelected(new Set())}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  aria-label={tc("selectAll")}
                  className="size-4 accent-[var(--primary)]"
                  checked={allPageSelected}
                  disabled={selectablePageIds.length === 0}
                  onChange={togglePage}
                />
              </TableHead>
              <TableHead>{tc("date")}</TableHead>
              <TableHead>{t("teacher")}</TableHead>
              <TableHead>{t("gradeLevel")}</TableHead>
              <TableHead className="text-end">{tc("hours")}</TableHead>
              <TableHead className="text-end">{tc("total")}</TableHead>
              <TableHead>{tc("status")}</TableHead>
              <TableHead>{t("paymentStatus")}</TableHead>
              <TableHead className="text-end">{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {search.filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((r) => (
              <TableRow key={r.id} className={selected.has(r.id) ? "bg-primary/5" : undefined}>
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={r.date}
                    className="size-4 accent-[var(--primary)]"
                    checked={selected.has(r.id)}
                    disabled={!payable(r)}
                    onChange={() => toggle(r.id)}
                  />
                </TableCell>
                <TableCell className="tabular-nums" dir="ltr">
                  {r.date} {r.time}
                </TableCell>
                <TableCell>{r.teacherName}</TableCell>
                <TableCell>{r.levelLabel}</TableCell>
                <TableCell className="text-end tabular-nums">{formatHours(r.hours)}</TableCell>
                <TableCell className="text-end tabular-nums">{formatMoney(r.total)}</TableCell>
                <TableCell>
                  <Badge variant={SESSION_STATUS_VARIANT[r.status] ?? "muted"}>
                    {te(`sessionStatus.${r.status}`)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={payVariant(r.paymentStatus)}>
                    {te(`paymentStatus.${r.paymentStatus}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-end">
                  {payable(r) && (
                    <QuickPayDialog
                      studentId={studentId}
                      studentName={studentName}
                      amount={r.total}
                      currency={currency}
                      teachers={teachers}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination {...pg} />
      </div>
    </div>
  );
}
