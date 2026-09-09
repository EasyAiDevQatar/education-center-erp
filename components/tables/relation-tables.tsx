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
import { formatDateOnly } from "@/lib/date-only";
import { Link } from "@/i18n/navigation";
import { referenceCode } from "@/lib/reference-code";

/* Read-only, paginated tables used across the 360° profile pages. */

export type SessionLine = {
  id: string;
  referenceNo: number;
  studentId: string;
  teacherId: string | null;
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
  DRAFT: "warning",
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
  linkStudents = false,
  linkTeachers = false,
  linkSessions = false,
}: {
  rows: SessionLine[];
  currency: string;
  hideStudent?: boolean;
  hideTeacher?: boolean;
  linkStudents?: boolean;
  linkTeachers?: boolean;
  linkSessions?: boolean;
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
            <TableHead>{t("sessionCode")}</TableHead>
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
              <TableCell colSpan={9} className="text-center text-muted-foreground">
                {tc("noData")}
              </TableCell>
            </TableRow>
          )}
          {pg.pageItems.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="text-start font-medium tabular-nums" dir="ltr">
                {linkSessions ? (
                  <Link href={`/sessions/${s.id}`} className="text-primary hover:underline">
                    {referenceCode("session", s.referenceNo)}
                  </Link>
                ) : referenceCode("session", s.referenceNo)}
              </TableCell>
              <TableCell className="text-start tabular-nums">
                {linkSessions ? (
                  <Link href={`/sessions/${s.id}`} className="text-primary hover:underline" dir="ltr">
                    {formatDateOnly(s.date)} {s.time}
                  </Link>
                ) : (
                  <span dir="ltr">{formatDateOnly(s.date)} {s.time}</span>
                )}
              </TableCell>
              {!hideStudent && (
                <TableCell className="font-medium">
                  {linkStudents ? (
                    <Link href={`/students/${s.studentId}`} className="text-primary hover:underline">
                      {s.studentName}
                    </Link>
                  ) : s.studentName}
                </TableCell>
              )}
              {!hideTeacher && (
                <TableCell>
                  {linkTeachers && s.teacherId ? (
                    <Link href={`/teachers/${s.teacherId}`} className="text-primary hover:underline">
                      {s.teacherName}
                    </Link>
                  ) : s.teacherName}
                </TableCell>
              )}
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
  studentId: string | null;
  teacherId: string | null;
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
  linkStudents = false,
  linkTeachers = false,
  linkReceipts = false,
}: {
  rows: PaymentLine[];
  currency: string;
  hideStudent?: boolean;
  linkStudents?: boolean;
  linkTeachers?: boolean;
  linkReceipts?: boolean;
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
              <TableCell className="text-start tabular-nums"><span dir="ltr">{formatDateOnly(p.date)}</span></TableCell>
              <TableCell className="text-start tabular-nums">
                {linkReceipts ? (
                  <Link href={`/receipt/${p.id}`} className="text-primary hover:underline" dir="ltr">
                    {p.receiptNo}
                  </Link>
                ) : (
                  <span dir="ltr">{p.receiptNo}</span>
                )}
              </TableCell>
              {!hideStudent && (
                <TableCell className="font-medium">
                  {linkStudents && p.studentId ? (
                    <Link href={`/students/${p.studentId}`} className="text-primary hover:underline">
                      {p.studentName}
                    </Link>
                  ) : p.studentName}
                </TableCell>
              )}
              <TableCell>{te(`method.${p.method}`)}</TableCell>
              <TableCell>
                {linkTeachers && p.teacherId ? (
                  <Link href={`/teachers/${p.teacherId}`} className="text-primary hover:underline">
                    {p.teacherName ?? "—"}
                  </Link>
                ) : p.teacherName ?? "—"}
              </TableCell>
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
              <TableCell className="text-start tabular-nums"><span dir="ltr">
                {formatDateOnly(p.periodStart)} → {formatDateOnly(p.periodEnd)}
              </span></TableCell>
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
