import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { TrendingUp, TrendingDown, Wallet, Users, Phone, Mail } from "lucide-react";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { loadSessionLines, loadPaymentLines, getCurrency } from "@/lib/profile";
import { formatMoney } from "@/lib/money";
import { Link } from "@/i18n/navigation";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { ProfileTabs } from "@/components/profile-tabs";
import { SessionsTable, PaymentsTable } from "@/components/tables/relation-tables";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PortalLoginButton } from "@/components/portal-login-button";
import { displayName, fullName } from "@/lib/names";

export default async function GuardianProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const session = await requireRole(locale, STAFF_ROLES);
  const isAdmin = session.role === "ADMIN";

  const t = await getTranslations("guardians");
  const ts = await getTranslations("students");
  const tc = await getTranslations("common");
  const tp = await getTranslations("profile");

  const guardian = await db.guardian.findUnique({
    where: { id },
    include: { students: { include: { gradeLevel: true } } },
  });
  if (!guardian) notFound();

  // Only an admin can mint portal logins, so only they see the control.
  const linkedUser = isAdmin
    ? await db.user.findUnique({ where: { guardianId: id }, select: { id: true } })
    : null;

  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) ?? "overview";

  const childIds = guardian.students.map((s) => s.id);

  // Family-wide totals: every child's charges and payments.
  const [charges, paid, sessions, payments, currency] = await Promise.all([
    db.session.aggregate({ _sum: { total: true }, where: { studentId: { in: childIds } } }),
    db.payment.aggregate({ _sum: { amount: true }, where: { studentId: { in: childIds } } }),
    childIds.length ? loadSessionLines({ studentId: { in: childIds } }, locale) : Promise.resolve([]),
    childIds.length ? loadPaymentLines({ studentId: { in: childIds } }) : Promise.resolve([]),
    getCurrency(),
  ]);

  const totalCharges = Number(charges._sum.total ?? 0);
  const totalPaid = Number(paid._sum.amount ?? 0);
  const balance = totalCharges - totalPaid;

  const tabs = [
    { key: "overview", label: tp("overview") },
    { key: "children", label: t("students"), count: guardian.students.length },
    { key: "sessions", label: tp("sessions"), count: sessions.length },
    { key: "payments", label: tp("payments"), count: payments.length },
  ];

  return (
    <div>
      <PageHeader title={fullName(guardian, locale)} description={guardian.phone ?? undefined} />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={ts("totalCharges")} value={formatMoney(totalCharges)} suffix={currency} icon={TrendingUp} />
        <StatCard label={ts("totalPaid")} value={formatMoney(totalPaid)} suffix={currency} icon={TrendingDown} tone="success" />
        <StatCard
          label={ts("balance")}
          value={formatMoney(balance)}
          suffix={currency}
          icon={Wallet}
          tone={balance > 0 ? "destructive" : "success"}
        />
        <StatCard label={t("students")} value={String(guardian.students.length)} icon={Users} />
      </div>

      <ProfileTabs tabs={tabs} active={tab} basePath={`/guardians/${id}`} />

      {tab === "overview" && (
        <Card>
          <CardHeader>
            <CardTitle>{tp("details")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row icon={<Phone className="size-4" />} label={tc("phone")} value={guardian.phone ?? "—"} />
            <Row icon={<Mail className="size-4" />} label={tc("email")} value={guardian.email ?? "—"} />
            {guardian.notes && <Row label={tc("notes")} value={guardian.notes} />}
            {isAdmin && (
              <div className="pt-2">
                <PortalLoginButton kind="guardian" recordId={id} hasLogin={!!linkedUser} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "children" && (
        <div className="rounded-lg border border-border bg-card p-2">
          {guardian.students.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{tc("noData")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {guardian.students.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                  <Link href={`/students/${s.id}`} className="font-medium text-primary hover:underline">
                    {displayName(s, locale)}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {s.gradeLevel ? (locale === "ar" ? s.gradeLevel.nameAr : s.gradeLevel.nameEn) : "—"}
                  </span>
                  <Badge variant={s.active ? "success" : "muted"}>
                    {s.active ? tc("active") : tc("inactive")}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "sessions" && <SessionsTable rows={sessions} currency={currency} />}
      {tab === "payments" && <PaymentsTable rows={payments} currency={currency} />}
    </div>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
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
