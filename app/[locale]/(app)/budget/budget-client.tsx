"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Archive,
  Calculator,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileSpreadsheet,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  Target,
  TriangleAlert,
  TrendingUp,
  Upload,
  Wallet,
} from "lucide-react";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { FormField } from "@/components/crud/form-field";
import { BudgetChart } from "@/components/charts/budget-chart";
import { PrintButton } from "@/components/print-button";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePathname, useRouter } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import type { BudgetMonthMetrics, BudgetPeriodMetrics } from "@/lib/budget";
import type { BudgetPlanReportData } from "@/lib/budget-queries";
import {
  archiveBudgetPlan,
  copyBudgetMonth,
  saveBudgetMonth,
  saveBudgetPlan,
} from "./actions";

type PlanOption = {
  id: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
};

type CategoryOption = {
  id: string;
  nameAr: string;
  nameEn: string;
  active: boolean;
  sortOrder: number;
};

type DefaultPlan = { name: string; startDate: string; endDate: string };

type BudgetImportIssue = { row: number; code: string; value?: string };
type BudgetImportResponse = {
  ok?: boolean;
  error?: string;
  imported?: number;
  months?: number;
  issues?: BudgetImportIssue[];
};

function PlanFields({
  plan,
  defaults,
}: {
  plan?: BudgetPlanReportData["plan"];
  defaults: DefaultPlan;
}) {
  const t = useTranslations("budget");
  return (
    <>
      <FormField label={t("planName")} htmlFor="budget-name">
        <Input
          id="budget-name"
          name="name"
          required
          maxLength={120}
          placeholder={t("planNamePlaceholder")}
          defaultValue={plan?.name ?? defaults.name}
        />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("startDate")} htmlFor="budget-start">
          <Input
            id="budget-start"
            name="startDate"
            type="date"
            dir="ltr"
            required
            defaultValue={plan?.startDate ?? defaults.startDate}
          />
        </FormField>
        <FormField label={t("endDate")} htmlFor="budget-end">
          <Input
            id="budget-end"
            name="endDate"
            type="date"
            dir="ltr"
            required
            defaultValue={plan?.endDate ?? defaults.endDate}
          />
        </FormField>
      </div>
      <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
        <input
          type="checkbox"
          name="includePayrollActual"
          defaultChecked={plan?.includePayrollActual ?? true}
          className="mt-0.5 size-4 accent-primary"
        />
        <span>
          <span className="block font-medium">{t("includePayroll")}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {t("includePayrollHint")}
          </span>
        </span>
      </label>
      <FormField label={t("notes")} htmlFor="budget-notes">
        <Input id="budget-notes" name="notes" maxLength={1000} defaultValue={plan?.notes ?? ""} />
      </FormField>
    </>
  );
}

function PlanDialog({
  plan,
  defaults,
  children,
}: {
  plan?: BudgetPlanReportData["plan"];
  defaults: DefaultPlan;
  children: React.ReactNode;
}) {
  const t = useTranslations("budget");
  const locale = useLocale();
  return (
    <EntityDialog
      title={plan ? t("editPlan") : t("newPlan")}
      trigger={children}
      action={saveBudgetPlan.bind(null, locale, plan?.id ?? null)}
      fields={<PlanFields plan={plan} defaults={defaults} />}
      errorNamespace="budget"
      wide
    />
  );
}

function MonthBudgetDialog({
  data,
  categories,
  selectedMonth,
  children,
}: {
  data: BudgetPlanReportData;
  categories: CategoryOption[];
  selectedMonth: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("budget");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const monthItems = data.items.filter((item) => item.month === selectedMonth);
  const income = monthItems.find((item) => item.kind === "INCOME")?.amount ?? 0;
  const expenseByCategory = new Map(
    monthItems
      .filter((item) => item.kind === "EXPENSE" && item.expenseCategoryId)
      .map((item) => [item.expenseCategoryId!, item]),
  );
  const visibleCategories = useMemo(() => {
    const ids = new Set(monthItems.map((item) => item.expenseCategoryId).filter(Boolean));
    return categories.filter((category) => category.active || ids.has(category.id));
  }, [categories, monthItems]);
  const [plannedIncome, setPlannedIncome] = useState(String(income || ""));
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      visibleCategories.map((category) => [
        category.id,
        expenseByCategory.get(category.id)?.amount
          ? String(expenseByCategory.get(category.id)?.amount)
          : "",
      ]),
    ),
  );
  const [behaviors, setBehaviors] = useState<Record<string, "FIXED" | "VARIABLE">>(() =>
    Object.fromEntries(
      visibleCategories.map((category) => [
        category.id,
        expenseByCategory.get(category.id)?.behavior === "VARIABLE" ? "VARIABLE" : "FIXED",
      ]),
    ),
  );

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveBudgetMonth(locale, {
        planId: data.plan.id,
        month: selectedMonth,
        plannedIncome: Number(plannedIncome || 0),
        expenses: visibleCategories.map((category) => ({
          categoryId: category.id,
          amount: Number(amounts[category.id] || 0),
          behavior: behaviors[category.id] ?? "FIXED",
        })),
      });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else setError(result.error ?? "invalid");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("editMonth")}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t("editHint")}</p>
        </DialogHeader>
        <FormField label={t("plannedIncome")} htmlFor="budget-income" hint={t("plannedIncomeHint")}>
          <Input
            id="budget-income"
            type="number"
            min="0"
            max="1000000000"
            step="0.01"
            dir="ltr"
            value={plannedIncome}
            onChange={(event) => setPlannedIncome(event.target.value)}
          />
        </FormField>
        <div className="rounded-md border border-border">
          <div className="border-b border-border p-3">
            <p className="font-medium">{t("expensePlan")}</p>
            <p className="text-xs text-muted-foreground">{t("expensePlanHint")}</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">{t("category")}</TableHead>
                <TableHead>{t("behavior")}</TableHead>
                <TableHead>{t("amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleCategories.map((category) => (
                <TableRow key={category.id}>
                  <TableCell className="text-start font-medium">
                    {locale === "ar" ? category.nameAr : category.nameEn}
                    {!category.active && <Badge variant="muted" className="ms-2">{t("archived")}</Badge>}
                  </TableCell>
                  <TableCell>
                    <Select
                      aria-label={t("behavior")}
                      value={behaviors[category.id] ?? "FIXED"}
                      onChange={(event) =>
                        setBehaviors((current) => ({
                          ...current,
                          [category.id]: event.target.value as "FIXED" | "VARIABLE",
                        }))
                      }
                    >
                      <option value="FIXED">{t("fixed")}</option>
                      <option value="VARIABLE">{t("variable")}</option>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`${t("amount")} — ${locale === "ar" ? category.nameAr : category.nameEn}`}
                      type="number"
                      min="0"
                      max="1000000000"
                      step="0.01"
                      dir="ltr"
                      className="mx-auto w-36"
                      value={amounts[category.id] ?? ""}
                      onChange={(event) =>
                        setAmounts((current) => ({ ...current, [category.id]: event.target.value }))
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
              {visibleCategories.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-muted-foreground">
                    {t("emptyMonth")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {error && <p className="text-sm text-destructive">{t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.invalid")}</p>}
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline">{tc("cancel")}</Button></DialogClose>
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? tc("saving") : tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyMonthDialog({
  planId,
  months,
  selectedMonth,
  onCopied,
  children,
}: {
  planId: string;
  months: string[];
  selectedMonth: string;
  onCopied: (month: string) => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("budget");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const selectedIndex = Math.max(0, months.indexOf(selectedMonth));
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState(months[Math.max(0, selectedIndex - 1)] ?? selectedMonth);
  const [target, setTarget] = useState(selectedMonth);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const monthLabel = (value: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${value}-01T00:00:00.000Z`),
    );

  function copy() {
    setError(null);
    startTransition(async () => {
      const result = await copyBudgetMonth(locale, { planId, sourceMonth: source, targetMonth: target });
      if (result.ok) {
        setOpen(false);
        router.refresh();
        onCopied(target);
      } else setError(result.error ?? "invalid");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("copyMonth")}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("copyFrom")}>
            <Select value={source} onChange={(event) => setSource(event.target.value)}>
              {months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}
            </Select>
          </FormField>
          <FormField label={t("copyTo")}>
            <Select value={target} onChange={(event) => setTarget(event.target.value)}>
              {months.map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}
            </Select>
          </FormField>
        </div>
        {error && <p className="text-sm text-destructive">{t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.invalid")}</p>}
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline">{tc("cancel")}</Button></DialogClose>
          <Button type="button" onClick={copy} disabled={pending || source === target}>
            {pending ? tc("saving") : t("copy")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BudgetImportDialog({
  planId,
  children,
}: {
  planId: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("budget");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<BudgetImportResponse | null>(null);

  function close(next: boolean) {
    setOpen(next);
    if (!next) {
      setFile(null);
      setResult(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function errorText(code: string, value?: string) {
    const key = `importIssues.${code}`;
    return t.has(key) ? t(key, { value: value ?? "" }) : t("errors.invalidRows");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    if (!file) {
      setResult({ error: "noFile" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setResult({ error: "fileTooLarge" });
      return;
    }

    const form = new FormData();
    form.set("planId", planId);
    form.set("file", file);
    setPending(true);
    try {
      const response = await fetch("/api/budget/import", { method: "POST", body: form });
      const body = (await response.json().catch(() => ({ error: "importFailed" }))) as BudgetImportResponse;
      setResult(body);
      if (response.ok && body.ok) {
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        router.refresh();
      }
    } catch {
      setResult({ error: "importFailed" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("importTitle")}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t("importHint")}</p>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-start gap-3 rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/8 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
            <p>{t("importReplacesHint")}</p>
          </div>

          <div className="rounded-md border border-dashed border-border p-4">
            <label htmlFor="budget-import-file" className="flex cursor-pointer items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <FileSpreadsheet className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{t("chooseSpreadsheet")}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {file?.name ?? t("spreadsheetRequirements")}
                </span>
              </span>
            </label>
            <input
              ref={fileInputRef}
              id="budget-import-file"
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="sr-only"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setResult(null);
              }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 p-3 text-sm">
            <div>
              <p className="font-medium">{t("downloadSample")}</p>
              <p className="text-xs text-muted-foreground">{t("sampleHint")}</p>
            </div>
            <Button asChild type="button" variant="outline" size="sm">
              <a href={`/api/budget/sample?planId=${encodeURIComponent(planId)}&locale=${locale}`} download>
                <Download />{t("downloadSample")}
              </a>
            </Button>
          </div>

          {result?.ok && (
            <div role="status" className="rounded-md border border-[var(--success)]/30 bg-[var(--success)]/8 p-3 text-sm text-[var(--success)]">
              {t("importSuccess", { rows: result.imported ?? 0, months: result.months ?? 0 })}
            </div>
          )}
          {result?.error && (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <p className="font-medium">
                {t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t("errors.importFailed")}
              </p>
              {result.issues && result.issues.length > 0 && (
                <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto ps-5 text-xs">
                  {result.issues.map((issue, index) => (
                    <li key={`${issue.row}-${issue.code}-${index}`}>
                      {t("importIssueLine", {
                        row: issue.row || "—",
                        message: errorText(issue.code, issue.value),
                      })}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">{tc("close")}</Button></DialogClose>
            <Button type="submit" disabled={pending || !file}>
              {pending ? <Loader2 className="animate-spin" /> : <Upload />}
              {pending ? t("importing") : t("importBudget")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function money(value: number, currency: string) {
  return `${formatMoney(value)} ${currency}`;
}

function amountTone(value: number) {
  return value > 0 ? "text-[var(--success)]" : value < 0 ? "text-destructive" : "text-muted-foreground";
}

function PlanningCards({ metrics, currency }: { metrics: BudgetPeriodMetrics; currency: string }) {
  const t = useTranslations("budget");
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label={t("plannedIncome")} value={money(metrics.plannedIncome, currency)} icon={Target} tone="primary" hint={t("plannedIncomeHint")} />
      <StatCard label={t("sessionForecast")} value={money(metrics.projectedIncome, currency)} icon={CalendarDays} tone="success" hint={t("sessionForecastHint")} />
      <StatCard label={t("plannedExpenses")} value={money(metrics.plannedExpenses, currency)} icon={Wallet} hint={`${t("fixedCosts")}: ${money(metrics.plannedFixedExpenses, currency)} · ${t("variableCosts")}: ${money(metrics.plannedVariableExpenses, currency)}`} />
      <StatCard label={t("breakEvenRevenue")} value={metrics.breakEven.breakEvenRevenue == null ? "—" : money(metrics.breakEven.breakEvenRevenue, currency)} icon={Calculator} tone="primary" hint={t("breakEvenHint")} />
    </div>
  );
}

function ActualCards({
  metrics,
  currency,
  includePayroll,
}: {
  metrics: BudgetPeriodMetrics;
  currency: string;
  includePayroll: boolean;
}) {
  const t = useTranslations("budget");
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label={t("earnedTuition")} value={money(metrics.earnedIncome, currency)} icon={TrendingUp} tone="success" hint={t("earnedTuitionHint")} />
      <StatCard label={t("netCash")} value={money(metrics.cashCollected, currency)} icon={Receipt} tone={metrics.cashCollected < 0 ? "destructive" : "default"} hint={t("netCashHint")} />
      <StatCard label={t("actualCosts")} value={money(metrics.actualExpenses, currency)} icon={Wallet} hint={t("actualCostsHint", { payroll: includePayroll ? "yes" : "no" })} />
      <StatCard label={t("actualNet")} value={money(metrics.actualSurplus, currency)} icon={TrendingUp} tone={metrics.actualSurplus >= 0 ? "success" : "destructive"} />
    </div>
  );
}

function BreakEvenPanel({ metrics, currency }: { metrics: BudgetPeriodMetrics; currency: string }) {
  const t = useTranslations("budget");
  const be = metrics.breakEven;
  if (be.breakEvenRevenue == null) {
    const impossible = be.variableCostRatio != null && be.contributionMarginRatio == null;
    return (
      <Card className={impossible ? "border-[var(--warning)]/50" : "border-dashed"}>
        <CardContent className="flex items-center gap-3 py-5">
          <Calculator className={impossible ? "size-8 text-[var(--warning)]" : "size-8 text-muted-foreground"} />
          <p className="text-sm text-muted-foreground">
            {t(impossible ? "impossibleBreakEven" : "noBreakEvenData")}
          </p>
        </CardContent>
      </Card>
    );
  }
  const reached = (be.additionalRevenueNeeded ?? 0) <= 0;
  const pct = be.breakEvenRevenue > 0 ? Math.min(100, (metrics.projectedIncome / be.breakEvenRevenue) * 100) : 100;
  return (
    <Card className={reached ? "border-[var(--success)]/40" : "border-[var(--warning)]/50"}>
      <CardContent className="space-y-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm text-muted-foreground">{t("status")}</p>
            <Badge variant={reached ? "success" : "warning"} className="mt-1">
              {reached ? t("aboveBreakEven") : t("belowBreakEven")}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <div><p className="text-muted-foreground">{t("additionalRevenue")}</p><p className="font-semibold tabular-nums">{money(be.additionalRevenueNeeded ?? 0, currency)}</p></div>
            <div><p className="text-muted-foreground">{t("breakEvenSessions")}</p><p className="font-semibold tabular-nums">{be.breakEvenSessions ?? "—"}</p></div>
            <div><p className="text-muted-foreground">{t("additionalSessions")}</p><p className="font-semibold tabular-nums">{be.additionalSessionsNeeded ?? "—"}</p></div>
            <div><p className="text-muted-foreground">{t("forecastSessions")}</p><p className="font-semibold tabular-nums">{metrics.forecastSessions}</p></div>
          </div>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </CardContent>
    </Card>
  );
}

type ExpenseComparisonRow = {
  id: string;
  category?: { nameAr: string; nameEn: string; sortOrder: number };
  label?: string;
  budget: number;
  actual: number;
  variance: number;
  behavior: string | null;
  unplanned: boolean;
};

function ExpenseComparison({
  data,
  categories,
  selectedMonth,
  currency,
}: {
  data: BudgetPlanReportData;
  categories: CategoryOption[];
  selectedMonth: string;
  currency: string;
}) {
  const t = useTranslations("budget");
  const tc = useTranslations("common");
  const locale = useLocale();
  const planned = data.items.filter((item) => item.month === selectedMonth && item.kind === "EXPENSE");
  const actualRows = data.expenseCategoryActuals?.filter((item) => item.month === selectedMonth) ?? [];
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const plannedMap = new Map(planned.filter((item) => item.expenseCategoryId).map((item) => [item.expenseCategoryId!, item]));
  const actualMap = new Map(actualRows.map((item) => [item.categoryId, item.amount]));
  const ids = [...new Set([...plannedMap.keys(), ...actualMap.keys()])];
  const rows: ExpenseComparisonRow[] = ids
    .map((id) => {
      const item = plannedMap.get(id);
      const category = categoryMap.get(id) ?? actualRows.find((row) => row.categoryId === id)?.category;
      const budget = item?.amount ?? 0;
      const actual = actualMap.get(id) ?? 0;
      return { id, category, budget, actual, variance: budget - actual, behavior: item?.behavior ?? null, unplanned: !item };
    });
  const payroll = data.monthlyActuals.find((row) => row.month === selectedMonth)?.payrollActual ?? 0;
  if (payroll > 0) {
    rows.push({
      id: "PAID_PAYROLL",
      label: t("paidPayroll"),
      budget: 0,
      actual: payroll,
      variance: -payroll,
      behavior: null,
      unplanned: false,
    });
  }
  rows.sort((a, b) => (a.category?.sortOrder ?? 999) - (b.category?.sortOrder ?? 999));
  const hasUnplanned = rows.some((row) => row.unplanned && row.actual > 0);
  const totals = rows.reduce(
    (sum, row) => ({ budget: sum.budget + row.budget, actual: sum.actual + row.actual }),
    { budget: 0, actual: 0 },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("expensePlan")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("behaviorHint")}</p>
      </CardHeader>
      <CardContent>
        {hasUnplanned && (
          <div className="mb-3 rounded-md border border-[var(--warning)]/40 bg-[var(--warning)]/8 p-3 text-sm">
            <p className="font-medium">{t("unplannedCategories")}</p>
            <p className="text-muted-foreground">{t("unplannedCategoriesHint")}</p>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-start">{t("category")}</TableHead>
              <TableHead>{t("behavior")}</TableHead>
              <TableHead>{t("plannedExpenses")}</TableHead>
              <TableHead>{t("actualCosts")}</TableHead>
              <TableHead>{t("expenseVariance")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-start font-medium">
                  {row.label ?? (row.category ? (locale === "ar" ? row.category.nameAr : row.category.nameEn) : "—")}
                </TableCell>
                <TableCell>{row.behavior ? t(row.behavior === "VARIABLE" ? "variable" : "fixed") : row.unplanned ? <Badge variant="warning">{t("unplannedCategories")}</Badge> : "—"}</TableCell>
                <TableCell dir="ltr" className="tabular-nums">{money(row.budget, currency)}</TableCell>
                <TableCell dir="ltr" className="tabular-nums">{money(row.actual, currency)}</TableCell>
                <TableCell dir="ltr" className={`font-medium tabular-nums ${amountTone(row.variance)}`}>{money(row.variance, currency)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-8 text-muted-foreground">{t("emptyMonth")}</TableCell></TableRow>
            )}
            {rows.length > 0 && (
              <TableRow className="bg-muted/30 font-semibold">
                <TableCell className="text-start">{tc("total")}</TableCell>
                <TableCell>—</TableCell>
                <TableCell dir="ltr">{money(totals.budget, currency)}</TableCell>
                <TableCell dir="ltr">{money(totals.actual, currency)}</TableCell>
                <TableCell dir="ltr" className={amountTone(totals.budget - totals.actual)}>{money(totals.budget - totals.actual, currency)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function AnnualTable({ rows, currency }: { rows: BudgetMonthMetrics[]; currency: string }) {
  const t = useTranslations("budget");
  const locale = useLocale();
  const label = (month: string) => new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00.000Z`));
  return (
    <Card>
      <CardHeader><CardTitle>{t("monthlyComparison")}</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("month")}</TableHead>
              <TableHead>{t("plannedIncome")}</TableHead>
              <TableHead>{t("sessionForecast")}</TableHead>
              <TableHead>{t("earnedTuition")}</TableHead>
              <TableHead>{t("netCash")}</TableHead>
              <TableHead>{t("plannedExpenses")}</TableHead>
              <TableHead>{t("actualCosts")}</TableHead>
              <TableHead>{t("status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const be = row.breakEven.breakEvenRevenue;
              const reached = be != null && (row.breakEven.additionalRevenueNeeded ?? 0) <= 0;
              return (
                <TableRow key={row.month}>
                  <TableCell className="whitespace-nowrap font-medium">{label(row.month)}</TableCell>
                  <TableCell dir="ltr">{money(row.plannedIncome, currency)}</TableCell>
                  <TableCell dir="ltr">{money(row.projectedIncome, currency)}</TableCell>
                  <TableCell dir="ltr">{money(row.earnedIncome, currency)}</TableCell>
                  <TableCell dir="ltr">{money(row.cashCollected, currency)}</TableCell>
                  <TableCell dir="ltr">{money(row.plannedExpenses, currency)}</TableCell>
                  <TableCell dir="ltr">{money(row.actualExpenses, currency)}</TableCell>
                  <TableCell>
                    {be == null ? <span className="text-muted-foreground">—</span> : <Badge variant={reached ? "success" : "warning"}>{reached ? t("aboveBreakEven") : t("belowBreakEven")}</Badge>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function BudgetClient({
  plans,
  data,
  categories,
  view,
  selectedMonth,
  defaultPlan,
  currency,
  centerName,
  defaultPrintFormat,
}: {
  plans: PlanOption[];
  data: BudgetPlanReportData | null;
  categories: CategoryOption[];
  view: "monthly" | "annual";
  selectedMonth: string;
  defaultPlan: DefaultPlan;
  currency: string;
  centerName: string;
  defaultPrintFormat: string;
}) {
  const t = useTranslations("budget");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [archivePending, startArchive] = useTransition();

  function go(next: { plan?: string; view?: "monthly" | "annual"; month?: string }) {
    const params = new URLSearchParams();
    const plan = next.plan ?? data?.plan.id;
    if (plan) params.set("plan", plan);
    params.set("view", next.view ?? view);
    const nextMonth = next.month ?? selectedMonth;
    if ((next.view ?? view) === "monthly" && nextMonth) params.set("month", nextMonth);
    router.push(`${pathname}?${params.toString()}`);
  }

  if (!data) {
    return (
      <Card className="mx-auto max-w-2xl border-dashed">
        <CardContent className="flex flex-col items-center px-6 py-14 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Calculator className="size-7" />
          </div>
          <h2 className="mt-4 text-xl font-semibold">{t("noPlansTitle")}</h2>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">{t("noPlansHint")}</p>
          <PlanDialog defaults={defaultPlan}>
            <Button className="mt-5"><Plus />{t("createCurrentPlan")}</Button>
          </PlanDialog>
        </CardContent>
      </Card>
    );
  }

  const months = data.report.months.map((row) => row.month);
  const index = Math.max(0, months.indexOf(selectedMonth));
  const metrics = view === "annual" ? data.report.annual : (data.report.months[index] ?? data.report.annual);
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${selectedMonth}-01T00:00:00.000Z`));
  const editable = data.plan.status !== "ARCHIVED";
  const planId = data.plan.id;
  const chartData = (view === "annual" ? data.report.months : [data.report.months[index]]).filter(Boolean).map((row) => ({
    month: new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(new Date(`${row.month}-01T00:00:00.000Z`)),
    plannedIncome: row.plannedIncome,
    projectedIncome: row.projectedIncome,
    plannedExpenses: row.plannedExpenses,
    actualExpenses: row.actualExpenses,
  }));

  function archive() {
    if (!window.confirm(t("archiveConfirm"))) return;
    startArchive(async () => {
      await archiveBudgetPlan(locale, planId);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-2">
        <div className="min-w-56 flex-1 sm:max-w-xs">
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="budget-plan-select">{t("plan")}</label>
          <Select id="budget-plan-select" value={data.plan.id} onChange={(event) => go({ plan: event.target.value, month: "" })}>
            {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}{plan.status === "ARCHIVED" ? ` · ${t("archived")}` : ""}</option>)}
          </Select>
        </div>
        <div role="group" aria-label={t("period")} className="flex items-center rounded-md border border-border p-0.5">
          <button type="button" aria-pressed={view === "monthly"} onClick={() => go({ view: "monthly" })} className={view === "monthly" ? "rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground" : "rounded px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"}>{t("monthly")}</button>
          <button type="button" aria-pressed={view === "annual"} onClick={() => go({ view: "annual" })} className={view === "annual" ? "rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground" : "rounded px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"}>{t("annual")}</button>
        </div>
        {view === "monthly" && (
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
            <Button variant="ghost" size="icon" className="size-8" disabled={index <= 0} onClick={() => go({ month: months[index - 1] })} aria-label={t("previousMonth")}>
              {locale === "ar" ? <ChevronRight /> : <ChevronLeft />}
            </Button>
            <span className="min-w-36 text-center text-sm font-medium">{monthLabel}</span>
            <Button variant="ghost" size="icon" className="size-8" disabled={index >= months.length - 1} onClick={() => go({ month: months[index + 1] })} aria-label={t("nextMonth")}>
              {locale === "ar" ? <ChevronLeft /> : <ChevronRight />}
            </Button>
          </div>
        )}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {editable && view === "monthly" && (
            <>
              <MonthBudgetDialog key={`${selectedMonth}-${data.plan.updatedAt}`} data={data} categories={categories} selectedMonth={selectedMonth}>
                <Button size="sm"><Pencil />{t("editMonth")}</Button>
              </MonthBudgetDialog>
              {months.length > 1 && (
                <CopyMonthDialog planId={data.plan.id} months={months} selectedMonth={selectedMonth} onCopied={(month) => go({ month })}>
                  <Button size="sm" variant="outline"><Copy />{t("copyMonth")}</Button>
                </CopyMonthDialog>
              )}
            </>
          )}
          {editable && (
            <PlanDialog plan={data.plan} defaults={defaultPlan}>
              <Button size="sm" variant="outline"><Pencil />{t("editPlan")}</Button>
            </PlanDialog>
          )}
          {editable && (
            <BudgetImportDialog planId={data.plan.id}>
              <Button size="sm" variant="outline"><Upload />{t("importBudget")}</Button>
            </BudgetImportDialog>
          )}
          <PlanDialog defaults={defaultPlan}>
            <Button size="sm" variant="outline"><Plus />{t("newPlan")}</Button>
          </PlanDialog>
          {editable && <Button size="sm" variant="ghost" onClick={archive} disabled={archivePending}><Archive />{t("archive")}</Button>}
          <PrintButton defaultFormat={defaultPrintFormat} />
        </div>
      </div>

      <div className="hidden print:mb-4 print:block print:text-center">
        <div className="font-bold">{centerName}</div>
        <div>{t("title")} · {data.plan.name}</div>
        <div className="text-sm text-muted-foreground">{view === "annual" ? `${data.plan.startDate} — ${data.plan.endDate}` : monthLabel}</div>
      </div>

      <div data-print="A4" data-print-size-selectable className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
          <div>
            <h2 className="font-semibold">{data.plan.name}</h2>
            <p dir="ltr" className="text-start text-xs text-muted-foreground">{data.plan.startDate} — {data.plan.endDate}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={editable ? "success" : "muted"}>{editable ? t("active") : t("archived")}</Badge>
            <span className="text-xs text-muted-foreground">{t("allAmounts", { currency })}</span>
          </div>
        </div>

        <PlanningCards metrics={metrics} currency={currency} />
        <BreakEvenPanel metrics={metrics} currency={currency} />
        <ActualCards metrics={metrics} currency={currency} includePayroll={data.plan.includePayrollActual} />

        {view === "annual" ? (
          <>
            <Card>
              <CardHeader><CardTitle>{t("chartTitle")}</CardTitle><p className="text-sm text-muted-foreground">{t("chartHint")}</p></CardHeader>
              <CardContent><BudgetChart data={chartData} labels={{ plannedIncome: t("plannedIncome"), projectedIncome: t("sessionForecast"), plannedExpenses: t("plannedExpenses"), actualExpenses: t("actualCosts") }} /></CardContent>
            </Card>
            <AnnualTable rows={data.report.months} currency={currency} />
          </>
        ) : (
          <ExpenseComparison data={data} categories={categories} selectedMonth={selectedMonth} currency={currency} />
        )}
      </div>
    </div>
  );
}
