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
import { computePay, anySalary, type EarningsMode } from "@/lib/earnings-mode";

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
  /** Resolved SALARY | COMMISSION | BOTH — what this teacher is actually owed. */
  earningsMode: EarningsMode;
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
  earnMode: string | null;
};
export type Period = { from: string; to: string };
export type TermOpt = { id: string; label: string; startDate: string; endDate: string };

/** One line of the payslip breakdown. Muted when the mode suppresses it. */
function PayLine({
  label,
  value,
  currency,
  tone = "normal",
}: {
  label: string;
  value: number;
  currency: string;
  tone?: "normal" | "muted" | "negative" | "total";
}) {
  const row =
    tone === "total"
      ? "flex items-center justify-between border-t border-border pt-1.5 text-base font-semibold"
      : tone === "muted"
        ? "flex items-center justify-between text-sm text-muted-foreground"
        : "flex items-center justify-between text-sm";
  return (
    <div className={row}>
      <span>{label}</span>
      <span className={tone === "negative" ? "tabular-nums text-destructive" : "tabular-nums"}>
        {tone === "negative" && value > 0 ? "−" : ""}
        {formatMoney(value)} {currency}
      </span>
    </div>
  );
}

function PayslipFields({
  teacherId,
  teacherName,
  period,
  commission,
  salary,
  deductions,
  earningsMode,
  currency,
  mode,
  terms,
  currentTermId,
  defaultMonth,
}: {
  teacherId: string;
  teacherName: string;
  period: Period;
  commission: number;
  salary: number;
  deductions: number;
  earningsMode: EarningsMode;
  currency: string;
  mode: "SESSION" | "MONTH" | "TERM";
  terms: TermOpt[];
  currentTermId: string | null;
  defaultMonth: string;
}) {
  const t = useTranslations("payroll");
  const tc = useTranslations("common");
  const tm = useTranslations("paymentModes");
  const tem = useTranslations("earningsModes");

  // Advances are the only figure edited here, so the breakdown recalculates as
  // the user types rather than surprising them after they save.
  const [advances, setAdvances] = useState(0);
  const pay = computePay(earningsMode, { commission, salary, deductions, advances });

  return (
    <>
      <input type="hidden" name="teacherId" value={teacherId} />

      <div className="rounded-md bg-accent/60 px-3 py-2">
        <div className="font-medium">{teacherName}</div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>
            {t("payMode")}: {tm(mode)}
          </span>
          <span>
            {t("earningsBasis")}: {tem(earningsMode)}
          </span>
        </div>
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

      <FormField label={t("advances")} htmlFor="advances" hint={t("advancesHint")}>
        <Input
          id="advances"
          name="advances"
          type="number"
          step="5"
          min="0"
          dir="ltr"
          value={advances}
          onChange={(e) => setAdvances(Math.max(0, Number(e.target.value) || 0))}
        />
      </FormField>

      {/* What the teacher actually receives, and why. A single "commission"
          figure left the reader to do this arithmetic in their head. */}
      <div className="space-y-1.5 rounded-md border border-border p-3">
        <PayLine
          label={t("grossCommission")}
          value={pay.commission}
          currency={currency}
          tone={earningsMode === "SALARY" ? "muted" : "normal"}
        />
        <PayLine
          label={t("salaryLine")}
          value={pay.salary}
          currency={currency}
          tone={earningsMode === "COMMISSION" ? "muted" : "normal"}
        />
        {pay.deductions > 0 && (
          <PayLine label={t("deductions")} value={pay.deductions} currency={currency} tone="negative" />
        )}
        {pay.advances > 0 && (
          <PayLine label={t("advances")} value={pay.advances} currency={currency} tone="negative" />
        )}
        <PayLine label={t("netPaid")} value={pay.net} currency={currency} tone="total" />
        {earningsMode !== "BOTH" && (
          <p className="pt-1 text-xs text-muted-foreground">
            {t("earningsExcluded", {
              part: earningsMode === "SALARY" ? t("grossCommission") : t("salaryLine"),
            })}
          </p>
        )}
      </div>

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
  const tem = useTranslations("earningsModes");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const tm = useTranslations("paymentModes");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();
  // A column of zeroes is noise; the salary column appears only once someone
  // on the page is actually paid one.
  const showSalary = anySalary(earnings);
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
              <TableHead>{tt("hoursTaught")}</TableHead>
              <TableHead>{tt("expectedIncome")}</TableHead>
              <TableHead>{tt("collectedIncome")}</TableHead>
              <TableHead>{tt("commissionPct")}</TableHead>
              <TableHead>{tt("commissionExpected")}</TableHead>
              <TableHead>{tt("commissionDue")}</TableHead>
              {showSalary && <TableHead>{tt("fixedSalary")}</TableHead>}
              <TableHead>{tt("netPayable")}</TableHead>
              <TableHead>{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pgE.pageItems.map((e) => (
              <TableRow key={e.teacherId}>
                <TableCell className="font-medium">
                  {e.name}
                  <span className="ms-1 text-xs font-normal text-muted-foreground">
                    · {tem(e.earningsMode)}
                  </span>
                </TableCell>
                <TableCell className="tabular-nums">{formatHours(e.hours)}</TableCell>
                <TableCell className="tabular-nums">{formatMoney(e.expected)}</TableCell>
                <TableCell className="tabular-nums">{formatMoney(e.collected)}</TableCell>
                <TableCell className="tabular-nums">{e.commissionPct}%</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{formatMoney(e.expectedCommission)}</TableCell>
                <TableCell className="tabular-nums font-medium">{formatMoney(e.dueCommission)} {currency}</TableCell>
                {showSalary && (
                  <TableCell className="tabular-nums">{formatMoney(e.fixedSalary)}</TableCell>
                )}
                <TableCell className="tabular-nums font-semibold">{formatMoney(e.netPayable)} {currency}</TableCell>
                <TableCell>
                  <EntityDialog
                    title={t("createPayslip")}
                    action={createPayout.bind(null, locale)}
                    fields={
                      <PayslipFields
                        teacherId={e.teacherId}
                        teacherName={e.name}
                        period={period}
                        commission={e.dueCommission}
                        salary={e.fixedSalary}
                        deductions={e.fixedDeductions}
                        earningsMode={e.earningsMode}
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
              <TableHead>{t("grossCommission")}</TableHead>
              <TableHead>{t("advances")}</TableHead>
              <TableHead>{t("netPaid")}</TableHead>
              <TableHead>{tc("status")}</TableHead>
              <TableHead>{tc("actions")}</TableHead>
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
                <TableCell className="text-xs tabular-nums"><span dir="ltr">
                  {p.periodStart} → {p.periodEnd}
                </span></TableCell>
                <TableCell className="tabular-nums">{formatMoney(p.grossCommission)}</TableCell>
                <TableCell className="tabular-nums">{formatMoney(p.advances)}</TableCell>
                <TableCell className="tabular-nums font-medium">{formatMoney(p.netPaid)} {currency}</TableCell>
                <TableCell>
                  <Badge variant={p.status === "PAID" ? "success" : "warning"}>
                    {te(`payoutStatus.${p.status}`)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-center gap-1">
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
