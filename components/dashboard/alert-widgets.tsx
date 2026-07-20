import { getTranslations } from "next-intl/server";
import { CalendarClock, FileWarning, PackageX, Wallet } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatHours } from "@/lib/money";
import type { getDashboardAlerts } from "@/lib/report-queries";

type Alerts = Awaited<ReturnType<typeof getDashboardAlerts>>;

/** "What needs attention" strip: today's load plus the three standing risks. */
export async function AlertWidgets({
  alerts,
  currency,
}: {
  alerts: Alerts;
  currency: string;
}) {
  const t = await getTranslations("dashboard");
  const tc = await getTranslations("common");

  return (
    <div className="mb-4 grid gap-4 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CalendarClock className="size-4" />
            {t("todaysSessions")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold tabular-nums">{alerts.todaysSessions}</div>
          <Link href="/calendar?view=day" className="text-xs text-primary hover:underline">
            {t("openCalendar")}
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileWarning className="size-4" />
            {t("unconfirmedDrafts")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={
              alerts.unconfirmedDrafts > 0
                ? "text-2xl font-bold tabular-nums text-warning"
                : "text-2xl font-bold tabular-nums"
            }
          >
            {alerts.unconfirmedDrafts}
          </div>
          <Link href="/planner" className="text-xs text-primary hover:underline">
            {t("openPlanner")}
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <PackageX className="size-4" />
            {t("expiringPackages")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {alerts.expiringPackages.length === 0 && (
            <p className="text-muted-foreground">{tc("noData")}</p>
          )}
          {alerts.expiringPackages.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{p.studentName}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums" dir="ltr">
                {formatHours(p.remaining)}h · {p.expiresAt}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Wallet className="size-4" />
            {t("topDebtors")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {alerts.debtors.length === 0 && <p className="text-muted-foreground">{tc("noData")}</p>}
          {alerts.debtors.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2">
              <Link href={`/students/${d.id}`} className="truncate hover:underline">
                {d.name}
              </Link>
              <Badge variant="destructive" className="shrink-0 tabular-nums">
                {formatMoney(d.balance)} {currency}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
