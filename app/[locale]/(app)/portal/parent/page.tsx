import { getTranslations, setRequestLocale } from "next-intl/server";
import { Receipt, FileText } from "lucide-react";
import { requireParentPortal, loadParentPortal } from "@/lib/portal";
import { db } from "@/lib/db";
import { formatMoney, formatHours } from "@/lib/money";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProfileTabs } from "@/components/profile-tabs";

export default async function ParentPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { guardianId } = await requireParentPortal(locale);

  const t = await getTranslations("portal");
  const tc = await getTranslations("common");
  const te = await getTranslations("enums");

  const [{ children }, settings] = await Promise.all([
    loadParentPortal(guardianId, locale),
    db.setting.findMany({ where: { key: "currency" } }),
  ]);
  const currency = settings[0]?.value ?? "QAR";

  const sp = await searchParams;
  const childParam = Array.isArray(sp.child) ? sp.child[0] : sp.child;
  const active = children.find((c) => c.id === childParam) ?? children[0];

  if (!active) {
    return (
      <div>
        <PageHeader title={t("parentTitle")} />
        <p className="text-sm text-muted-foreground">{t("noChildren")}</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t("parentTitle")} description={t("parentSubtitle")} />

      {children.length > 1 && (
        <ProfileTabs
          tabs={children.map((c) => ({ key: c.id, label: c.name }))}
          active={active.id}
          basePath="/portal/parent"
          param="child"
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("balance")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={
                active.balance > 0
                  ? "text-2xl font-bold tabular-nums text-destructive"
                  : "text-2xl font-bold tabular-nums text-[var(--success)]"
              }
            >
              {formatMoney(active.balance)} <span className="text-base">{currency}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("charges")}: {formatMoney(active.charges)} · {t("paid")}:{" "}
              {formatMoney(active.paid)}
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("packages")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {active.packages.length === 0 && <p className="text-muted-foreground">{tc("noData")}</p>}
            {active.packages.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2">
                <span>
                  {formatHours(p.remaining)} / {formatHours(p.totalHours)} {tc("hours")}
                </span>
                <span className="flex items-center gap-2">
                  {p.expiresAt && (
                    <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                      {p.expiresAt}
                    </span>
                  )}
                  <Badge variant={p.status === "ACTIVE" ? "success" : "default"}>
                    {te(`packageStatus.${p.status}`)}
                  </Badge>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t("recentSessions")}</CardTitle>
            <Link
              href={`/statement/student/${active.id}`}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <FileText className="size-4" />
              {t("statement")}
            </Link>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {active.sessions.length === 0 && <p className="text-muted-foreground">{tc("noData")}</p>}
            {active.sessions.slice(0, 15).map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-2 border-b border-border/60 pb-2 last:border-0"
              >
                <div>
                  <div className="font-medium">{s.teacherName}</div>
                  <div className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                    {s.date} {s.time} · {formatHours(s.hours)}
                  </div>
                </div>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatMoney(s.total)}</span>
                  <Badge variant={s.status === "COMPLETED" ? "success" : "default"}>
                    {te(`sessionStatus.${s.status}`)}
                  </Badge>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("payments")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {active.payments.length === 0 && <p className="text-muted-foreground">{tc("noData")}</p>}
            {active.payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2">
                <span className="tabular-nums" dir="ltr">{p.date}</span>
                <span className="flex items-center gap-2">
                  <span className="font-medium tabular-nums">
                    {formatMoney(p.amount)} {currency}
                  </span>
                  <Link
                    href={`/receipt/${p.id}`}
                    className="text-primary hover:underline"
                    aria-label={t("viewReceipt")}
                  >
                    <Receipt className="size-4" />
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
