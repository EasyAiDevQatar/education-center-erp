"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Trash2, ArrowUpRight } from "lucide-react";
import { useRouter, Link } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
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
import { formatMoney } from "@/lib/money";
import { PAYSLIP_METHODS } from "@/lib/enums";
import { createPayrollRun, deleteRun } from "./actions";

export type RunRow = {
  id: string;
  month: string;
  status: string;
  paymentMethod: string | null;
  itemCount: number;
  total: number;
  createdAt: string;
  paidAt: string | null;
};

type EmpOpt = { id: string; label: string; isTeacher: boolean };

function NewRunDialog({
  employees,
  onClose,
}: {
  employees: EmpOpt[];
  onClose: () => void;
}) {
  const t = useTranslations("runs");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();

  const now = new Date();
  const defaultMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const [month, setMonth] = useState(defaultMonth);
  const [method, setMethod] = useState("BANK");
  // Everyone in by default — a payroll run's normal case is the whole staff.
  const [ids, setIds] = useState<string[]>(employees.map((e) => e.id));
  const [warned, setWarned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = (id: string) =>
    setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  function run(force: boolean) {
    setError(null);
    start(async () => {
      const res = await createPayrollRun(locale, {
        month,
        employeeIds: ids,
        paymentMethod: method,
        force,
      });
      if (res.ok && res.runId) {
        onClose();
        router.push(`/payroll/runs/${res.runId}`);
        router.refresh();
      } else if (res.error === "monthHasRun") {
        // The month already has a run — surface it and require a second click.
        setWarned(true);
      } else {
        setError(res.error ?? "invalid");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("newRun")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t("month")} htmlFor="run-month">
              <Input
                id="run-month"
                type="month"
                dir="ltr"
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  setWarned(false);
                }}
                required
              />
            </FormField>
            <FormField label={t("method")} htmlFor="run-method">
              <Select id="run-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAYSLIP_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {te(`payslipMethod.${m}`)}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <FormField label={t("employees")} hint={t("employeesHint")}>
            <div className="mb-2 flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setIds(employees.map((e) => e.id))}
              >
                {tc("selectAll")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setIds([])}>
                {tc("clear")}
              </Button>
            </div>
            <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-md border border-border p-2">
              {employees.length === 0 && (
                <p className="py-3 text-center text-sm text-muted-foreground">
                  {t("noEmployees")}
                </p>
              )}
              {employees.map((e) => (
                <label
                  key={e.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--primary)]"
                    checked={ids.includes(e.id)}
                    onChange={() => toggle(e.id)}
                  />
                  <span className="truncate">{e.label}</span>
                  {e.isTeacher && (
                    <Badge variant="default" className="ms-auto shrink-0 px-1 py-0 text-[10px]">
                      {t("plusCommission")}
                    </Badge>
                  )}
                </label>
              ))}
            </div>
          </FormField>

          {warned && (
            <p className="rounded-md border border-warning/50 bg-warning/10 p-2 text-sm">
              {t("monthHasRunWarning", { month })}
            </p>
          )}
          {error && (
            <p className="text-sm text-destructive">
              {tc.has(`errors.${error}`) ? tc(`errors.${error}`) : tc("errorGeneric")}
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {tc("cancel")}
            </Button>
          </DialogClose>
          <Button disabled={pending || ids.length === 0 || !month} onClick={() => run(warned)}>
            {pending ? tc("saving") : warned ? t("generateAnyway") : t("generate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RunsClient({ runs, employees }: { runs: RunRow[]; employees: EmpOpt[] }) {
  const t = useTranslations("runs");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();
  const [showNew, setShowNew] = useState(false);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button className="gap-1" onClick={() => setShowNew(true)}>
          <Plus className="size-4" />
          {t("newRun")}
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("month")}</TableHead>
              <TableHead>{t("payslips")}</TableHead>
              <TableHead>{tc("total")}</TableHead>
              <TableHead>{t("method")}</TableHead>
              <TableHead>{tc("status")}</TableHead>
              <TableHead>{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium tabular-nums">
                  <span dir="ltr">
                    {r.month}
                  </span>
                </TableCell>
                <TableCell className="tabular-nums">{r.itemCount}</TableCell>
                <TableCell className="tabular-nums font-medium">
                  {formatMoney(r.total)}
                </TableCell>
                <TableCell>
                  {r.paymentMethod ? te(`payslipMethod.${r.paymentMethod}`) : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={r.status === "PAID" ? "success" : "warning"}>
                    {te(`runStatus.${r.status}`)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-center gap-0.5">
                    <Link href={`/payroll/runs/${r.id}`}>
                      <Button variant="ghost" size="icon" aria-label={t("openRun")}>
                        <ArrowUpRight className="size-4" />
                      </Button>
                    </Link>
                    {r.status !== "PAID" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={tc("delete")}
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            await deleteRun(locale, r.id);
                            router.refresh();
                          })
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {showNew && <NewRunDialog employees={employees} onClose={() => setShowNew(false)} />}
    </div>
  );
}
