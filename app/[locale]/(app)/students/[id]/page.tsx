import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { TrendingUp, TrendingDown, Wallet, CalendarDays, Phone, MapPin, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { getStudentBalance, getStudentLedger } from "@/lib/balances";
import { loadSessionLines, loadPaymentLines, getCurrency } from "@/lib/profile";
import { formatMoney, toNumber } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { ProfileTabs } from "@/components/profile-tabs";
import { SessionsTable, PaymentsTable } from "@/components/tables/relation-tables";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LedgerTable } from "./ledger-table";

export default async function StudentProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);

  const t = await getTranslations("students");
  const tc = await getTranslations("common");
  const tp = await getTranslations("profile");
  const tpk = await getTranslations("packages");

  const student = await db.student.findUnique({
    where: { id },
    include: { gradeLevel: true, guardian: true },
  });
  if (!student) notFound();

  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) ?? "overview";

  const [balance, ledger, sessions, payments, packages, currency] = await Promise.all([
    getStudentBalance(id),
    getStudentLedger(id),
    loadSessionLines({ studentId: id }, locale),
    loadPaymentLines({ studentId: id }),
    db.package.findMany({ where: { studentId: id }, orderBy: { purchasedAt: "desc" } }),
    getCurrency(),
  ]);

  const tabs = [
    { key: "overview", label: tp("overview") },
    { key: "sessions", label: tp("sessions"), count: sessions.length },
    { key: "payments", label: tp("payments"), count: payments.length },
    { key: "statement", label: tp("statement") },
    { key: "packages", label: tpk("title"), count: packages.length },
  ];

  return (
    <div>
      <PageHeader
        title={student.name}
        description={
          [
            student.gradeLevel
              ? locale === "ar"
                ? student.gradeLevel.nameAr
                : student.gradeLevel.nameEn
              : null,
            student.guardian ? `${t("guardian")}: ${student.guardian.name}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("totalCharges")} value={formatMoney(balance.totalCharges)} suffix={currency} icon={TrendingUp} />
        <StatCard label={t("totalPaid")} value={formatMoney(balance.totalPaid)} suffix={currency} icon={TrendingDown} tone="success" />
        <StatCard
          label={t("balance")}
          value={formatMoney(balance.balance)}
          suffix={currency}
          icon={Wallet}
          tone={balance.balance > 0 ? "destructive" : "success"}
        />
        <StatCard label={tp("sessions")} value={String(sessions.length)} icon={CalendarDays} />
      </div>

      <ProfileTabs tabs={tabs} active={tab} basePath={`/students/${id}`} />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{tp("details")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row icon={<Phone className="size-4" />} label={tc("phone")} value={student.phone ?? "—"} />
              <Row label={t("guardian")} value={student.guardian?.name ?? "—"} />
              <Row label={tc("phone")} value={student.guardian?.phone ?? "—"} />
              <Row icon={<MapPin className="size-4" />} label={t("address")} value={student.address ?? "—"} />
              <Row
                label={t("homeLocation")}
                value={
                  student.homeLat != null && student.homeLng != null
                    ? `${student.homeLat.toFixed(5)}, ${student.homeLng.toFixed(5)}`
                    : "—"
                }
              />
              <Row label={tc("status")} value={student.active ? tc("active") : tc("inactive")} />
              {student.notes && <Row label={tc("notes")} value={student.notes} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tp("recentSessions")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <SessionsTable rows={sessions.slice(0, 5)} currency={currency} hideStudent />
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "sessions" && <SessionsTable rows={sessions} currency={currency} hideStudent />}
      {tab === "payments" && <PaymentsTable rows={payments} currency={currency} hideStudent />}
      {tab === "statement" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <a href={`/${locale}/statement/student/${id}`} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1">
                <Printer className="size-4" />
                {tc("print")}
              </Button>
            </a>
          </div>
          <LedgerTable ledger={ledger} />
        </div>
      )}

      {tab === "packages" && (
        <div className="rounded-lg border border-border bg-card p-4">
          {packages.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">{tc("noData")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {packages.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="tabular-nums" dir="ltr">
                    {p.purchasedAt.toISOString().slice(0, 10)}
                  </span>
                  <span className="tabular-nums">
                    {toNumber(p.hoursUsed)} / {toNumber(p.totalHours)} {tc("hours")}
                  </span>
                  <span className="tabular-nums">
                    {formatMoney(p.price)} {currency}
                  </span>
                  <Badge variant={p.status === "ACTIVE" ? "success" : "muted"}>{p.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-end font-medium">{value}</span>
    </div>
  );
}
