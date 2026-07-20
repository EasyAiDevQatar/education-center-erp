import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { TrendingUp, TrendingDown, Wallet, Clock, Phone, Percent } from "lucide-react";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { getTeacherEarnings } from "@/lib/payroll";
import { loadSessionLines, loadPaymentLines, loadPayoutLines, getCurrency } from "@/lib/profile";
import { formatMoney, formatHours, toNumber } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { ProfileTabs } from "@/components/profile-tabs";
import { SessionsTable, PaymentsTable, PayoutsTable } from "@/components/tables/relation-tables";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AvailabilityEditor } from "./availability-editor";
import { PortalLoginButton } from "@/components/portal-login-button";

export default async function TeacherProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);

  const t = await getTranslations("teachers");
  const tc = await getTranslations("common");
  const tp = await getTranslations("profile");
  const tm = await getTranslations("paymentModes");
  const ta = await getTranslations("availability");

  const teacher = await db.teacher.findUnique({ where: { id } });
  if (!teacher) notFound();

  // Only an admin can mint portal logins, so only they see the control.
  const session = await requireRole(locale, STAFF_ROLES);
  const isAdmin = session.role === "ADMIN";
  const linkedUser = isAdmin
    ? await db.user.findUnique({ where: { teacherId: id }, select: { id: true } })
    : null;

  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) ?? "overview";

  // All-time earnings for the profile header.
  const wideStart = new Date("2000-01-01T00:00:00.000Z");
  const wideEnd = new Date("2100-01-01T00:00:00.000Z");

  const [earnings, sessions, payments, payouts, currency, availability] = await Promise.all([
    getTeacherEarnings(id, wideStart, wideEnd),
    loadSessionLines({ teacherId: id }, locale),
    loadPaymentLines({ teacherId: id }),
    loadPayoutLines(id),
    getCurrency(),
    db.teacherAvailability.findMany({
      where: { teacherId: id },
      orderBy: [{ weekday: "asc" }, { startMin: "asc" }],
      select: { weekday: true, startMin: true, endMin: true },
    }),
  ]);

  const tabs = [
    { key: "overview", label: tp("overview") },
    { key: "sessions", label: tp("sessions"), count: sessions.length },
    { key: "payments", label: tp("payments"), count: payments.length },
    { key: "payouts", label: tp("payouts"), count: payouts.length },
    { key: "availability", label: ta("tab"), count: availability.length },
  ];

  return (
    <div>
      <PageHeader
        title={teacher.name}
        description={`${t("commissionPct")}: ${toNumber(teacher.commissionPct)}% · ${
          teacher.paymentMode ? tm(teacher.paymentMode as "SESSION") : t("paymentModeDefault")
        }`}
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("hoursTaught")} value={formatHours(earnings?.hours ?? 0)} icon={Clock} />
        <StatCard label={t("expectedIncome")} value={formatMoney(earnings?.expected ?? 0)} suffix={currency} icon={TrendingUp} />
        <StatCard label={t("collectedIncome")} value={formatMoney(earnings?.collected ?? 0)} suffix={currency} icon={TrendingDown} tone="success" />
        <StatCard label={t("commissionDue")} value={formatMoney(earnings?.dueCommission ?? 0)} suffix={currency} icon={Wallet} tone="primary" />
      </div>

      <ProfileTabs tabs={tabs} active={tab} basePath={`/teachers/${id}`} />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{tp("details")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row icon={<Phone className="size-4" />} label={tc("phone")} value={teacher.phone ?? "—"} />
              <Row icon={<Percent className="size-4" />} label={t("commissionPct")} value={`${toNumber(teacher.commissionPct)}%`} />
              <Row label={t("fixedSalary")} value={`${formatMoney(teacher.fixedSalary)} ${currency}`} />
              <Row label={t("fixedDeductions")} value={`${formatMoney(teacher.fixedDeductions)} ${currency}`} />
              <Row
                label={t("paymentMode")}
                value={teacher.paymentMode ? tm(teacher.paymentMode as "SESSION") : t("paymentModeDefault")}
              />
              <Row label={tc("status")} value={teacher.active ? tc("active") : tc("inactive")} />
              {teacher.notes && <Row label={tc("notes")} value={teacher.notes} />}
              {isAdmin && (
                <div className="pt-2">
                  <PortalLoginButton kind="teacher" recordId={id} hasLogin={!!linkedUser} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tp("earningsSummary")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label={t("commissionExpected")} value={`${formatMoney(earnings?.expectedCommission ?? 0)} ${currency}`} />
              <Row label={t("commissionDue")} value={`${formatMoney(earnings?.dueCommission ?? 0)} ${currency}`} />
              <Row label={t("fixedSalary")} value={`${formatMoney(earnings?.fixedSalary ?? 0)} ${currency}`} />
              <Row label={t("fixedDeductions")} value={`− ${formatMoney(earnings?.fixedDeductions ?? 0)} ${currency}`} />
              <div className="border-t border-border pt-2">
                <Row label={t("netPayable")} value={`${formatMoney(earnings?.netPayable ?? 0)} ${currency}`} />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "sessions" && <SessionsTable rows={sessions} currency={currency} hideTeacher />}
      {tab === "payments" && <PaymentsTable rows={payments} currency={currency} />}
      {tab === "payouts" && <PayoutsTable rows={payouts} currency={currency} />}
      {tab === "availability" && (
        <AvailabilityEditor teacherId={id} initial={availability} />
      )}
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
      <span className="text-end font-medium tabular-nums">{value}</span>
    </div>
  );
}
