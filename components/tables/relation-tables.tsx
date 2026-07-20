"use client";

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
import { formatMoney, formatHours } from "@/lib/money";

/* Read-only, paginated tables used across the 360° profile pages. */

export type SessionLine = {
  id: string;
  date: string;
  time: string;
  studentName: string;
  teacherName: string;
  levelLabel: string;
  location: string;
  hours: number;
  total: number;
  status: string;
  paymentStatus: string;
};

const SESSION_STATUS_VARIANT: Record<string, "success" | "warning" | "muted" | "destructive"> = {
  SCHEDULED: "muted",
  CHECKED_IN: "warning",
  COMPLETED: "success",
  NO_SHOW: "destructive",
  CANCELLED: "muted",
};

export function SessionsTable({
  rows,
  currency,
  hideStudent,
  hideTeacher,
}: {
  rows: SessionLine[];
  currency: string;
  hideStudent?: boolean;
  hideTeacher?: boolean;
}) {
  const t = useTranslations("sessions");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const pg = usePagination(rows);

  return (
    <div className="rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tc("date")}</TableHead>
            {!hideStudent && <TableHead>{t("student")}</TableHead>}
            {!hideTeacher && <TableHead>{t("teacher")}</TableHead>}
            <TableHead>{t("gradeLevel")}</TableHead>
            <TableHead>{t("location")}</TableHead>
            <TableHead className="text-end">{t("hours")}</TableHead>
            <TableHead className="text-end">{t("total")}</TableHead>
            <TableHead>{tc("status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground">
                {tc("noData")}
              </TableCell>
            </TableRow>
          )}
          {pg.pageItems.map((s) => (
            <TableRow key={s.id}>
              <TableCell dir="ltr" className="text-start tabular-nums">
                {s.date} {s.time}
              </TableCell>
              {!hideStudent && <TableCell className="font-medium">{s.studentName}</TableCell>}
              {!hideTeacher && <TableCell>{s.teacherName}</TableCell>}
              <TableCell>{s.levelLabel}</TableCell>
              <TableCell>{te(`location.${s.location}`)}</TableCell>
              <TableCell className="text-end tabular-nums">{formatHours(s.hours)}</TableCell>
              <TableCell className="text-end tabular-nums">
                {formatMoney(s.total)} {currency}
              </TableCell>
              <TableCell>
                <Badge variant={SESSION_STATUS_VARIANT[s.status] ?? "muted"}>
                  {te(`sessionStatus.${s.status}`)}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination {...pg} />
    </div>
  );
}

export type PaymentLine = {
  id: string;
  date: string;
  receiptNo: string;
  studentName: string;
  amount: number;
  method: string;
  teacherName: string | null;
};

export function PaymentsTable({
  rows,
  currency,
  hideStudent,
}: {
  rows: PaymentLine[];
  currency: string;
  hideStudent?: boolean;
}) {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const pg = usePagination(rows);

  return (
    <div className="rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tc("date")}</TableHead>
            <TableHead>{t("receiptNo")}</TableHead>
            {!hideStudent && <TableHead>{t("student")}</TableHead>}
            <TableHead>{t("method")}</TableHead>
            <TableHead>{t("allocateTeacher")}</TableHead>
            <TableHead className="text-end">{tc("amount")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                {tc("noData")}
              </TableCell>
            </TableRow>
          )}
          {pg.pageItems.map((p) => (
            <TableRow key={p.id}>
              <TableCell dir="ltr" className="text-start tabular-nums">{p.date}</TableCell>
              <TableCell dir="ltr" className="text-start tabular-nums">{p.receiptNo}</TableCell>
              {!hideStudent && <TableCell className="font-medium">{p.studentName}</TableCell>}
              <TableCell>{te(`method.${p.method}`)}</TableCell>
              <TableCell>{p.teacherName ?? "—"}</TableCell>
              <TableCell className="text-end tabular-nums font-medium">
                {formatMoney(p.amount)} {currency}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination {...pg} />
    </div>
  );
}

export type PayoutLine = {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossCommission: number;
  fixedSalary: number;
  deductions: number;
  advances: number;
  netPaid: number;
  status: string;
};

export function PayoutsTable({ rows, currency }: { rows: PayoutLine[]; currency: string }) {
  const t = useTranslations("payroll");
  const tt = useTranslations("teachers");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const pg = usePagination(rows);

  return (
    <div className="rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("period")}</TableHead>
            <TableHead className="text-end">{tt("commissionDue")}</TableHead>
            <TableHead className="text-end">{t("fixedSalary")}</TableHead>
            <TableHead className="text-end">{t("deductions")}</TableHead>
            <TableHead className="text-end">{t("advances")}</TableHead>
            <TableHead className="text-end">{t("netPaid")}</TableHead>
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
          {pg.pageItems.map((p) => (
            <TableRow key={p.id}>
              <TableCell dir="ltr" className="text-start tabular-nums">
                {p.periodStart} → {p.periodEnd}
              </TableCell>
              <TableCell className="text-end tabular-nums">{formatMoney(p.grossCommission)}</TableCell>
              <TableCell className="text-end tabular-nums">{formatMoney(p.fixedSalary)}</TableCell>
              <TableCell className="text-end tabular-nums">{formatMoney(p.deductions)}</TableCell>
              <TableCell className="text-end tabular-nums">{formatMoney(p.advances)}</TableCell>
              <TableCell className="text-end tabular-nums font-semibold">
                {formatMoney(p.netPaid)} {currency}
              </TableCell>
              <TableCell>
                <Badge variant={p.status === "PAID" ? "success" : "muted"}>
                  {te(`payoutStatus.${p.status}`)}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination {...pg} />
    </div>
  );
}
