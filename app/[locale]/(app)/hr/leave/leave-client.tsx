"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Check, X, Scale } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { leaveDays } from "@/lib/leave";
import type { LeaveBalanceRow } from "@/lib/leave-data";
import { createLeaveRequest, decideLeaveRequest, createLeaveAdjustment } from "./actions";

export type RequestRow = {
  id: string;
  employeeName: string;
  typeCode: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  reason: string | null;
};

type Opt = { id: string; label: string };
type TypeOpt = { code: string; label: string };

function RequestFields({ employees, types }: { employees: Opt[]; types: TypeOpt[] }) {
  const t = useTranslations("leave");
  const tc = useTranslations("common");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  // Live day count — the same pure function the server freezes at submission,
  // so what the admin sees is exactly what will be recorded.
  const days = start && end ? leaveDays(start, end) : 0;

  return (
    <>
      <FormField label={t("employee")} htmlFor="lr-emp">
        <Select id="lr-emp" name="employeeId" required defaultValue="">
          <option value="" disabled>
            —
          </option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t("type")} htmlFor="lr-type">
        <Select id="lr-type" name="typeCode" defaultValue="ANNUAL">
          {types.map((x) => (
            <option key={x.code} value={x.code}>
              {x.label}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("from")} htmlFor="lr-start">
          <Input
            id="lr-start"
            name="startDate"
            type="date"
            dir="ltr"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </FormField>
        <FormField label={t("to")} htmlFor="lr-end">
          <Input
            id="lr-end"
            name="endDate"
            type="date"
            dir="ltr"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </FormField>
      </div>
      {days > 0 && (
        <p className="rounded-md bg-accent/60 px-3 py-2 text-sm">
          {t("daysComputed", { n: days })}
        </p>
      )}
      <FormField label={t("reason")} htmlFor="lr-reason">
        <Input id="lr-reason" name="reason" />
      </FormField>
      <p className="text-xs text-muted-foreground">{tc("required")}: {t("calendarDaysNote")}</p>
    </>
  );
}

function AdjustmentFields({ employees, types }: { employees: Opt[]; types: TypeOpt[] }) {
  const t = useTranslations("leave");
  return (
    <>
      <FormField label={t("employee")} htmlFor="la-emp">
        <Select id="la-emp" name="employeeId" required defaultValue="">
          <option value="" disabled>
            —
          </option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t("type")} htmlFor="la-type">
        <Select id="la-type" name="typeCode" defaultValue="ANNUAL">
          {types.map((x) => (
            <option key={x.code} value={x.code}>
              {x.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t("adjustDays")} htmlFor="la-days" hint={t("adjustHint")}>
        <Input id="la-days" name="days" type="number" step="0.5" dir="ltr" required />
      </FormField>
      <FormField label={t("reason")} htmlFor="la-reason">
        <Input id="la-reason" name="reason" required />
      </FormField>
    </>
  );
}

export function LeaveClient({
  balances,
  requests,
  types,
  employees,
}: {
  balances: LeaveBalanceRow[];
  requests: RequestRow[];
  types: TypeOpt[];
  employees: Opt[];
}) {
  const t = useTranslations("leave");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();

  const pgB = usePagination(balances);
  const pending_ = useMemo(() => requests.filter((r) => r.status === "PENDING"), [requests]);
  const decided = useMemo(() => requests.filter((r) => r.status !== "PENDING"), [requests]);
  const pgR = usePagination(decided);

  const decide = (id: string, d: "APPROVED" | "REJECTED") =>
    start(async () => {
      await decideLeaveRequest(locale, id, d);
      router.refresh();
    });

  const typeLabel = (code: string) => types.find((x) => x.code === code)?.label ?? code;

  const statusVariant = (s: string) =>
    s === "APPROVED" ? "success" : s === "PENDING" ? "warning" : s === "REJECTED" ? "destructive" : "default";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2">
        <EntityDialog
          title={t("newRequest")}
          action={createLeaveRequest.bind(null, locale)}
          fields={<RequestFields employees={employees} types={types} />}
          trigger={
            <Button className="gap-1">
              <Plus className="size-4" />
              {t("newRequest")}
            </Button>
          }
        />
        <EntityDialog
          title={t("adjustTitle")}
          action={createLeaveAdjustment.bind(null, locale)}
          fields={<AdjustmentFields employees={employees} types={types} />}
          trigger={
            <Button variant="secondary" className="gap-1">
              <Scale className="size-4" />
              {t("adjustTitle")}
            </Button>
          }
        />
      </div>

      {/* Pending queue — first, because it is the thing waiting on a human. */}
      {pending_.length > 0 && (
        <div className="rounded-lg border-2 border-warning/50 bg-warning/5 p-3">
          <p className="mb-2 text-sm font-semibold">{t("pendingQueue", { n: pending_.length })}</p>
          <div className="space-y-1">
            {pending_.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                <span className="font-medium">{r.employeeName}</span>
                <Badge variant="default">{typeLabel(r.typeCode)}</Badge>
                <span className="tabular-nums" dir="ltr">
                  {r.startDate} → {r.endDate}
                </span>
                <span className="text-muted-foreground">{t("daysN", { n: r.days })}</span>
                {r.reason && <span className="text-xs text-muted-foreground">· {r.reason}</span>}
                <span className="ms-auto flex gap-1">
                  <Button
                    size="sm"
                    className="gap-1"
                    disabled={pending}
                    onClick={() => decide(r.id, "APPROVED")}
                  >
                    <Check className="size-3.5" />
                    {t("approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    disabled={pending}
                    onClick={() => decide(r.id, "REJECTED")}
                  >
                    <X className="size-3.5" />
                    {t("reject")}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Balances */}
      <div>
        <h2 className="mb-2 text-lg font-semibold">{t("balances")}</h2>
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc("name")}</TableHead>
                <TableHead className="text-end">{t("accrued")}</TableHead>
                <TableHead className="text-end">{t("adjustments")}</TableHead>
                <TableHead className="text-end">{t("taken")}</TableHead>
                <TableHead className="text-end">{t("pendingCol")}</TableHead>
                <TableHead className="text-end">{t("remaining")}</TableHead>
                <TableHead className="text-end">{t("sick")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pgB.pageItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    {tc("noData")}
                  </TableCell>
                </TableRow>
              )}
              {pgB.pageItems.map((b) => (
                <TableRow key={b.employeeId}>
                  <TableCell className="font-medium">
                    {b.name}
                    {!b.hireDate && (
                      <span className="ms-1 text-xs text-warning">{t("noHireDate")}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{b.annualEntitled}</TableCell>
                  <TableCell className="text-end tabular-nums">{b.annualAdjust || "—"}</TableCell>
                  <TableCell className="text-end tabular-nums">{b.annualTaken || "—"}</TableCell>
                  <TableCell className="text-end tabular-nums">{b.annualPending || "—"}</TableCell>
                  <TableCell
                    className={
                      b.annualRemaining < 0
                        ? "text-end font-semibold tabular-nums text-destructive"
                        : "text-end font-semibold tabular-nums"
                    }
                  >
                    {b.annualRemaining}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {b.sickTaken}/{b.sickCap}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination {...pgB} />
        </div>
      </div>

      {/* History */}
      <div>
        <h2 className="mb-2 text-lg font-semibold">{t("history")}</h2>
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tc("name")}</TableHead>
                <TableHead>{t("type")}</TableHead>
                <TableHead>{t("period")}</TableHead>
                <TableHead className="text-end">{t("days")}</TableHead>
                <TableHead>{tc("status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pgR.pageItems.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {tc("noData")}
                  </TableCell>
                </TableRow>
              )}
              {pgR.pageItems.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.employeeName}</TableCell>
                  <TableCell>{typeLabel(r.typeCode)}</TableCell>
                  <TableCell className="tabular-nums" dir="ltr">
                    {r.startDate} → {r.endDate}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{r.days}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(r.status)}>{t(`statuses.${r.status}`)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination {...pgR} />
        </div>
      </div>
    </div>
  );
}
