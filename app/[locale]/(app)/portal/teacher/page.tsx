import { getTranslations, setRequestLocale } from "next-intl/server";
import { Clock, CalendarDays, Wallet, FileText } from "lucide-react";
import { requireTeacherPortal, loadTeacherPortal } from "@/lib/portal";
import { db } from "@/lib/db";
import { formatMoney, formatHours } from "@/lib/money";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmOwnSessions } from "./confirm-own-sessions";

export default async function TeacherPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { teacherId } = await requireTeacherPortal(locale);

  const sp = await searchParams;
  const dParam = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const day =
    dParam && /^\d{4}-\d{2}-\d{2}$/.test(dParam) ? dParam : new Date().toISOString().slice(0, 10);

  const t = await getTranslations("portal");
  const tc = await getTranslations("common");
  const te = await getTranslations("enums");

  const [data, settings] = await Promise.all([
    loadTeacherPortal(teacherId, locale, day),
    db.setting.findMany({ where: { key: { in: ["currency", "teacherCanConfirm"] } } }),
  ]);
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const currency = map.currency ?? "QAR";
  // Off by default: letting teachers mark their own lessons taught is a money
  // decision, so the centre has to switch it on deliberately.
  const canConfirm = map.teacherCanConfirm === "true";

  return (
    <div>
      <PageHeader title={t("teacherTitle")} description={data.teacherName} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("monthSessions")} value={String(data.month.sessions)} icon={CalendarDays} />
        <StatCard label={t("monthHours")} value={formatHours(data.month.hours)} icon={Clock} />
        <StatCard
          label={t("monthExpected")}
          value={formatMoney(data.month.expected)}
          suffix={currency}
          icon={Wallet}
        />
        <StatCard
          label={t("monthCommission")}
          value={formatMoney(data.month.commission)}
          suffix={currency}
          icon={Wallet}
          tone="primary"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("todaysSessions")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.todays.length === 0 && <p className="text-muted-foreground">{tc("noData")}</p>}
            {data.todays.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 border-b border-border/60 pb-2 last:border-0">
                <div>
                  <div className="font-medium">{s.studentName}</div>
                  <div className="text-xs text-muted-foreground">
                    <span className="tabular-nums" dir="ltr">{s.time}</span> ·{" "}
                    {formatHours(s.hours)} · {te(`location.${s.location}`)}
                  </div>
                </div>
                <Badge variant={s.status === "COMPLETED" ? "success" : "default"}>
                  {te(`sessionStatus.${s.status}`)}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("todaysDrafts")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.drafts.length === 0 && <p className="text-muted-foreground">{tc("noData")}</p>}
            {data.drafts.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 border-b border-border/60 pb-2 last:border-0">
                <div>
                  <div className="font-medium">{d.studentName}</div>
                  <div className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                    {d.time} · {formatHours(d.hours)}
                  </div>
                </div>
                {canConfirm ? (
                  <ConfirmOwnSessions sessionId={d.id} locale={locale} />
                ) : (
                  <Badge variant="warning">{te("sessionStatus.DRAFT")}</Badge>
                )}
              </div>
            ))}
            {!canConfirm && data.drafts.length > 0 && (
              <p className="pt-1 text-xs text-muted-foreground">{t("confirmDisabledHint")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("upcoming")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.upcoming.length === 0 && <p className="text-muted-foreground">{tc("noData")}</p>}
            {data.upcoming.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2">
                <span>{s.studentName}</span>
                <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                  {s.date} {s.time}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("payslips")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.payouts.length === 0 && <p className="text-muted-foreground">{tc("noData")}</p>}
            {data.payouts.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2">
                <span className="tabular-nums" dir="ltr">
                  {p.periodStart} → {p.periodEnd}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium tabular-nums">
                    {formatMoney(p.netPaid)} {currency}
                  </span>
                  <Link
                    href={`/payslip/${p.id}`}
                    className="text-primary hover:underline"
                    aria-label={t("viewPayslip")}
                  >
                    <FileText className="size-4" />
                  </Link>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
