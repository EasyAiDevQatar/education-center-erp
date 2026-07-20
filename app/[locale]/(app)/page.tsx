import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  CalendarDays,
  Users,
  GraduationCap,
} from "lucide-react";
import { requireAuth } from "@/lib/rbac";
import {
  getDashboardSummary,
  getRevenueByTeacher,
  getExpensesByCategory,
  getMonthlyTrend,
} from "@/lib/reports";
import { getDashboardAlerts } from "@/lib/report-queries";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { AlertWidgets } from "@/components/dashboard/alert-widgets";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonthlyTrendChart } from "@/components/charts/monthly-trend-chart";

/** Resolve a period key to a concrete range (UTC, matching the data). */
function resolvePeriod(period: string): { from?: Date; to?: Date } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 1, 0, 0, 0, 0));
  const endOfMonth = (yy: number, mm: number) =>
    new Date(Date.UTC(yy, mm + 1, 0, 23, 59, 59, 999));

  switch (period) {
    case "thisMonth":
      return { from: start(y, m), to: endOfMonth(y, m) };
    case "lastMonth":
      return { from: start(y, m - 1), to: endOfMonth(y, m - 1) };
    case "thisYear":
      return { from: start(y, 0), to: endOfMonth(y, 11) };
    default:
      return {}; // all time
  }
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireAuth(locale);

  const t = await getTranslations("dashboard");
  const tc = await getTranslations("common");

  const sp = await searchParams;
  const periodRaw = Array.isArray(sp.period) ? sp.period[0] : sp.period;
  const period = periodRaw ?? "all";
  const range = resolvePeriod(period);

  const [summary, byTeacher, byCategory, trend, alerts] = await Promise.all([
    getDashboardSummary(range),
    getRevenueByTeacher(range),
    getExpensesByCategory(range),
    getMonthlyTrend(12),
    getDashboardAlerts(locale),
  ]);

  const cur = tc("currency");
  const maxTeacher = Math.max(1, ...byTeacher.map((r) => r.total));
  const maxCat = Math.max(1, ...byCategory.map((r) => r.total));

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("welcome", { name: session.name })}
      />

      <PeriodSelector active={period} />

      <AlertWidgets alerts={alerts} currency={cur} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={t("income")}
          value={formatMoney(summary.income)}
          suffix={cur}
          icon={TrendingUp}
          tone="success"
        />
        <StatCard
          label={t("expenses")}
          value={formatMoney(summary.expenses)}
          suffix={cur}
          icon={TrendingDown}
          tone="destructive"
        />
        <StatCard
          label={t("net")}
          value={formatMoney(summary.net)}
          suffix={cur}
          icon={Wallet}
          tone={summary.net >= 0 ? "primary" : "destructive"}
        />
        <StatCard
          label={t("outstanding")}
          value={formatMoney(summary.outstanding)}
          suffix={cur}
          icon={Wallet}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("sessionsCount")} value={formatMoney(summary.sessionsCount)} icon={CalendarDays} />
        <StatCard label={t("expectedIncome")} value={formatMoney(summary.expectedIncome)} suffix={cur} icon={TrendingUp} />
        <StatCard label={t("studentsCount")} value={formatMoney(summary.studentsCount)} icon={Users} />
        <StatCard label={t("activeTeachers")} value={formatMoney(summary.activeTeachers)} icon={GraduationCap} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("monthlyTrend")}</CardTitle>
        </CardHeader>
        <CardContent>
          <MonthlyTrendChart
            data={trend}
            labels={{ income: t("income"), expenses: t("expenses") }}
          />
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("revenueByTeacher")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {byTeacher.length === 0 && (
              <p className="text-sm text-muted-foreground">{tc("noData")}</p>
            )}
            {byTeacher.slice(0, 10).map((r) => (
              <div key={r.teacherId}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{r.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatMoney(r.total)} {cur}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(r.total / maxTeacher) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("expensesByCategory")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {byCategory.length === 0 && (
              <p className="text-sm text-muted-foreground">{tc("noData")}</p>
            )}
            {byCategory.slice(0, 10).map((r) => (
              <div key={r.categoryId}>
                <div className="mb-1 flex justify-between text-sm">
                  <span>{locale === "ar" ? r.nameAr : r.nameEn}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatMoney(r.total)} {cur}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-destructive"
                    style={{ width: `${(r.total / maxCat) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
