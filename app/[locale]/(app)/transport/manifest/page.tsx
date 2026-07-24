import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChevronLeft, ChevronRight, CheckCircle2, TriangleAlert, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { requireTransport } from "@/lib/transport/guard";
import { buildManifest, type ManifestIssue } from "@/lib/transport/manifest";
import { minToHHMM } from "@/lib/planner";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export default async function ManifestPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireTransport(locale);
  const t = await getTranslations("transportManifest");

  const sp = await searchParams;
  const dParam = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const day = dParam && /^\d{4}-\d{2}-\d{2}$/.test(dParam) ? dParam : new Date().toISOString().slice(0, 10);

  const m = await buildManifest(locale, day);

  const issueText = (i: ManifestIssue) =>
    i.code === "sessionNotServed" ? t("issue.sessionNotServed", { name: i.detail }) : t(`issue.${i.code}`);

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/transport/manifest?date=${shift(day, -1)}`} className="rounded-md border border-border p-2 hover:bg-accent">
          <ChevronRight className="size-4 rtl:hidden" />
          <ChevronLeft className="size-4 hidden rtl:block" />
        </Link>
        <span className="rounded-md border border-border px-3 py-1.5 font-medium tabular-nums" dir="ltr">{day}</span>
        <Link href={`/transport/manifest?date=${shift(day, 1)}`} className="rounded-md border border-border p-2 hover:bg-accent">
          <ChevronLeft className="size-4 rtl:hidden" />
          <ChevronRight className="size-4 hidden rtl:block" />
        </Link>
        <Link href="/transport/manifest" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">
          {t("today")}
        </Link>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label={t("teachers")} value={String(m.summary.total)} />
        <StatCard label={t("summaryOk")} value={String(m.summary.ok)} icon={CheckCircle2} />
        <StatCard label={t("summaryIssues")} value={String(m.summary.withIssues)} icon={TriangleAlert} />
      </div>

      {m.teachers.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          {t("noHomeSessions")}
        </div>
      ) : (
        <div className="space-y-3">
          {m.teachers.map((row) => (
            <Card key={row.teacherId} className={row.issues.length ? "border-destructive/40" : undefined}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <span>{row.name}</span>
                  <Badge variant="muted">{t("homeSessions", { n: row.homeSessions })}</Badge>
                  {row.issues.length === 0 ? (
                    <Badge variant="success" className="gap-1">
                      <CheckCircle2 className="size-3.5" />
                      {t("chainOk")}
                    </Badge>
                  ) : (
                    row.issues.map((i, idx) => (
                      <Badge key={idx} variant="destructive" className="gap-1">
                        <TriangleAlert className="size-3.5" />
                        {issueText(i)}
                      </Badge>
                    ))
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {row.stops.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noRide")}</p>
                ) : (
                  <ol className="space-y-1 text-sm">
                    {row.stops.map((st, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        {st.kind === "PICKUP" ? (
                          <Badge variant="default" className="gap-1">
                            <ArrowUpFromLine className="size-3" />
                            {t("pickup")}
                          </Badge>
                        ) : (
                          <Badge variant="muted" className="gap-1">
                            <ArrowDownToLine className="size-3" />
                            {t("dropoff")}
                          </Badge>
                        )}
                        <span className="tabular-nums text-muted-foreground" dir="ltr">{minToHHMM(st.plannedMin)}</span>
                        <span className="font-medium">{st.label}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
