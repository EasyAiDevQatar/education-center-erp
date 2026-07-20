"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Receipt, Printer, Check } from "lucide-react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { DeleteButton } from "@/components/crud/delete-button";
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
import { usePagination, TablePagination } from "@/components/ui/table-pagination";
import { formatMoney, formatHours } from "@/lib/money";
import { createPayout, markPayoutPaid, deletePayout } from "./actions";

export type EarningRow = {
  teacherId: string;
  name: string;
  commissionPct: number;
  hours: number;
  expected: number;
  collected: number;
  /** commissionPct x billed session totals. */
  expectedCommission: number;
  /** commissionPct x income actually collected — this is what gets paid. */
  dueCommission: number;
  fixedSalary: number;
  fixedDeductions: number;
  netPayable: number;
  /** Effective mode (teacher's own or the centre default). */
  mode: "SESSION" | "MONTH" | "TERM";
};
export type PayoutRow = {
  id: string;
  teacherName: string;
  periodStart: string;
  periodEnd: string;
  grossCommission: number;
  expectedCommission: number;
  fixedSalary: number;
  deductions: number;
  advances: number;
  netPaid: number;
  status: string;
  payMode: string | null;
};
export type Period = { from: string; to: string };
export type TermOpt = { id: string; label: string; startDate: string; endDate: string };

function PayslipFields({
  teacherId,
  period,
  commission,
  currency,
  mode,
  terms,
  currentTermId,
  defaultMonth,
}: {
  teacherId: string;
  period: Period;
  commission: number;
  currency: string;
  mode: "SESSION" | "MONTH" | "TERM";
  terms: TermOpt[];
  currentTermId: string | null;
  defaultMonth: string;
}) {
  const t = useTranslations("payroll");
  const tc = useTranslations("common");
  const tm = useTranslations("paymentModes");
  return (
    <>
      <input type="hidden" name="teacherId" value={teacherId} />

      <div className="flex items-center gap-2 rounded-md bg-accent/60 px-3 py-2 text-sm">
        <span className="text-muted-foreground">{t("payMode")}:</span>
        <span className="font-medium">{tm(mode)}</span>
      </div>

      {/* The period control follows the teacher's payment mode. */}
      {mode === "MONTH" ? (
        <>
          <FormField label={t("month")} htmlFor="month">
            <Input id="month" name="month" type="month" dir="ltr" defaultValue={defaultMonth} required />
          </FormField>
          <input type="hidden" name="periodStart" value={period.from} />
          <input type="hidden" name="periodEnd" value={period.to} />
        </>
      ) : mode === "TERM" ? (
        <>
          <FormField label={t("term")} htmlFor="termId">
            <Select id="termId" name="termId" defaultValue={currentTermId ?? terms[0]?.id ?? ""} required>
              {terms.length === 0 && <option value="">—</option>}
              {terms.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label} ({x.startDate} → {x.endDate})
                </option>
              ))}
            </Select>
          </FormField>
          <input type="hidden" name="periodStart" value={period.from} />
          <input type="hidden" name="periodEnd" value={period.to} />
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("periodStart")} htmlFor="periodStart">
            <Input id="periodStart" name="periodStart" type="date" dir="ltr" defaultValue={period.from} required />
          </FormField>
          <FormField label={t("periodEnd")} htmlFor="periodEnd">
            <Input id="periodEnd" name="periodEnd" type="date" dir="ltr" defaultValue={period.to} required />
          </FormField>
        </div>
      )}
      <div className="rounded-md bg-accent/60 px-3 py-2 text-sm">
        {t("grossCommission")}:{" "}
        <span className="font-semibold tabular-nums">{formatMoney(commission)} {currency}</span>
      </div>
      <FormField label={t("advances")} htmlFor="advances">
        <Input id="advances" name="advances" type="number" step="5" min="0" dir="ltr" defaultValue={0} />
      </FormField>
      <FormField label={tc("notes")} htmlFor="notes">
        <Input id="notes" name="notes" />
      </FormField>
    </>
  );
}

export function PayrollClient({
  earnings,
  payouts,
  period,
  filter,
  currency,
  locale: localeProp,
  terms,
  currentTermId,
  defaultMonth,
}: {
  earnings: EarningRow[];
  payouts: PayoutRow[];
  period: Period;
  filter: Period;
  currency: string;
  locale: string;
  terms: TermOpt[];
  currentTermId: string | null;
  defaultMonth: string;
}) {
  const t = useTranslations("payroll");
  const tt = useTranslations("teachers");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const tm = useTranslations("paymentModes");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();
  const pgE = usePagination(earnings);
  const pgP = usePagination(payouts);

  function applyPeriod(form: HTMLFormElement) {
    const fd = new FormData(form);
    const params = new URLSearchParams();
    for (const k of ["from", "to"]) {
      const v = String(fd.get(k) ?? "");
      if (v) params.set(k, v);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <>
      <form
        className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault();
          applyPeriod(e.currentTarget);
        }}
      >
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{tc("from")}</label>
          <Input name="from" type="date" dir="ltr" defaultValue={filter.from} className="w-40" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{tc("to")}</label>
          <Input name="to" type="date" dir="ltr" defaultValue={filter.to} className="w-40" />
        </div>
        <Button type="submit" variant="secondary">{tc("filter")}</Button>

        {/* Quick periods — terms come from Settings, month from today. */}
        <div className="ms-auto flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const [y, m] = defaultMonth.split("-").map(Number);
              const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
              const p2 = (n: number) => String(n).padStart(2, "0");
              router.push(`${pathname}?from=${y}-${p2(m)}-01&to=${y}-${p2(m)}-${p2(last)}`);
            }}
          >
            {t("thisMonth")}
          </Button>
          {terms.slice(0, 3).map((x) => (
            <Button
              key={x.id}
              type="button"
              variant={x.id === currentTermId ? "secondary" : "ghost"}
              size="sm"
              onClick={() => router.push(`${pathname}?from=${x.startDate}&to=${x.endDate}`)}
            >
              {x.label}
            </Button>
          ))}
        </div>
      </form>

      {/* Earnings */}
      <h2 className="mb-2 mt-6 text-lg font-semibold">{t("earnings")}</h2>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tc("name")}</TableHead>
              <TableHead className="text-end">{tt("hoursTaught")}</TableHead>
              <TableHead className="text-end">{tt("expectedIncome")}</TableHead>
              <TableHead className="text-end">{tt("collectedIncome")}</TableHead>
              <TableHead className="text-end">{tt("commissionPct")}</TableHead>
              <TableHead className="text-end">{tt("commissionExpected")}</TableHead>
              <TableHead className="text-end">{tt("commissionDue")}</TableHead>
              <TableHead className="text-end">{tt("fixedSalary")}</TableHead>
              <TableHead className="text-end">{tt("netPayable")}</TableHead>
              <TableHead className="text-end">{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pgE.pageItems.map((e) => (
              <TableRow key={e.teacherId}>
                <TableCell className="font-medium">{e.name}</TableCell>
                <TableCell className="text-end tabular-nums">{formatHours(e.hours)}</TableCell>
                <TableCell className="text-end tabular-nums">{formatMoney(e.expected)}</TableCell>
                <TableCell className="text-end tabular-nums">{formatMoney(e.collected)}</TableCell>
                <TableCell className="text-end tabular-nums">{e.commissionPct}%</TableCell>
                <TableCell className="text-end tabular-nums text-muted-foreground">{formatMoney(e.expectedCommission)}</TableCell>
                <TableCell className="text-end tabular-nums font-medium">{formatMoney(e.dueCommission)} {currency}</TableCell>
                <TableCell className="text-end tabular-nums">{formatMoney(e.fixedSalary)}</TableCell>
                <TableCell className="text-end tabular-nums font-semibold">{formatMoney(e.netPayable)} {currency}</TableCell>
                <TableCell className="text-end">
                  <EntityDialog
                    title={t("createPayslip")}
                    action={createPayout.bind(null, locale)}
                    fields={
                      <PayslipFields
                        teacherId={e.teacherId}
                        period={period}
                        commission={e.netPayable}
                        currency={currency}
                        mode={e.mode}
                        terms={terms}
                        currentTermId={currentTermId}
                        defaultMonth={defaultMonth}
                      />
                    }
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={t("createPayslip")}>
                        <Receipt className="size-4" />
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination {...pgE} />
      </div>

      {/* History */}
      <h2 className="mb-2 mt-8 text-lg font-semibold">{t("history")}</h2>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tc("name")}</TableHead>
              <TableHead>{t("payMode")}</TableHead>
              <TableHead>{t("period")}</TableHead>
              <TableHead className="text-end">{t("grossCommission")}</TableHead>
              <TableHead className="text-end">{t("advances")}</TableHead>
              <TableHead className="text-end">{t("netPaid")}</TableHead>
              <TableHead>{tc("status")}</TableHead>
              <TableHead className="text-end">{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payouts.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pgP.pageItems.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.teacherName}</TableCell>
                <TableCell>
                  {p.payMode ? (
                    <Badge variant="muted">{tm(p.payMode as "MONTH")}</Badge>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell dir="ltr" className="text-start text-xs tabular-nums">
                  {p.periodStart} → {p.periodEnd}
                </TableCell>
                <TableCell className="text-end tabular-nums">{formatMoney(p.grossCommission)}</TableCell>
                <TableCell className="text-end tabular-nums">{formatMoney(p.advances)}</TableCell>
                <TableCell className="text-end tabular-nums font-medium">{formatMoney(p.netPaid)} {currency}</TableCell>
                <TableCell>
                  <Badge variant={p.status === "PAID" ? "success" : "warning"}>
                    {te(`payoutStatus.${p.status}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-end">
                  <div className="flex justify-end gap-1">
                    <a href={`/${localeProp}/payslip/${p.id}`} target="_blank" rel="noopener">
                      <Button variant="ghost" size="icon" aria-label={t("payslip")}>
                        <Printer className="size-4" />
                      </Button>
                    </a>
                    {p.status !== "PAID" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("markPaid")}
                        disabled={pendingId === p.id}
                        onClick={() =>
                          start(async () => {
                            setPendingId(p.id);
                            await markPayoutPaid(locale, p.id);
                            setPendingId(null);
                          })
                        }
                        className="text-[var(--success)]"
                      >
                        <Check className="size-4" />
                      </Button>
                    )}
                    <DeleteButton action={deletePayout.bind(null, locale, p.id)} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination {...pgP} />
      </div>
    </>
  );
}
