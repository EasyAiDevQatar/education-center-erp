import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { TrendingUp, TrendingDown, Wallet, Clock, Phone, Percent, FileText } from "lucide-react";
import { requireRole, ACADEMIC_ROLES, PAYROLL_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { getTeacherEarnings } from "@/lib/payroll";
import { loadSessionLines, loadTeacherPaymentLines, loadPayoutLines, getCurrency } from "@/lib/profile";
import { formatMoney, formatHours, toNumber } from "@/lib/money";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { ProfileTabs } from "@/components/profile-tabs";
import { SendStatementButton } from "@/components/whatsapp-button";
import { SessionsTable, PaymentsTable, PayoutsTable } from "@/components/tables/relation-tables";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AvailabilityEditor } from "./availability-editor";
import { PortalLoginButton } from "@/components/portal-login-button";
import { fullName } from "@/lib/names";
import { referenceCode } from "@/lib/reference-code";

export default async function TeacherProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireRole(locale, ACADEMIC_ROLES);

  const t = await getTranslations("teachers");
  const tc = await getTranslations("common");
  const tp = await getTranslations("profile");
  const tm = await getTranslations("paymentModes");
  const ta = await getTranslations("availability");
  const ts = await getTranslations("students");

  const teacher = await db.teacher.findUnique({ where: { id } });
  if (!teacher) notFound();

  // Only an admin can mint portal logins, so only they see the control.
  const session = await requireRole(locale, ACADEMIC_ROLES);
  const isAdmin = session.role === "ADMIN";
  /**
   * Whether this viewer may see what the teacher is paid.
   *
   * An academic supervisor runs the timetable and needs the hours, the lessons
   * and the availability — not the commission, the salary or the payout
   * history. Gating the page would take the schedule away with the money, so
   * the money is gated inside it instead.
   */
  const canSeePay = (PAYROLL_ROLES as readonly string[]).includes(session.role);
  const linkedUser = isAdmin
    ? await db.user.findUnique({ where: { teacherId: id }, select: { id: true } })
    : null;

  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) ?? "overview";

  // All-time earnings for the profile header.
  const wideStart = new Date("2000-01-01T00:00:00.000Z");
  const wideEnd = new Date("2100-01-01T00:00:00.000Z");

  const [earnings, sessions, payments, payouts, currency, availability, studentLinks] = await Promise.all([
    getTeacherEarnings(id, wideStart, wideEnd),
    loadSessionLines({ teacherId: id }, locale),
    loadTeacherPaymentLines(id),
    loadPayoutLines(id),
    getCurrency(),
    db.teacherAvailability.findMany({
      where: { teacherId: id },
      orderBy: [{ weekday: "asc" }, { startMin: "asc" }],
      select: { weekday: true, startMin: true, endMin: true },
    }),
    db.studentTeacher.findMany({
      where: {
        teacherId: id,
        OR: [{ academicYear: { isCurrent: true } }, { academicYearId: null }],
      },
      include: { student: { include: { gradeLevel: true } } },
    }),
  ]);
  const assignedStudents = [
    ...new Map(studentLinks.map((row) => [row.studentId, row.student])).values(),
  ].sort((a, b) => fullName(a, locale).localeCompare(fullName(b, locale), locale));

  // What has already been settled, so the tab can show what remains.
  const paidOut = payouts.reduce((sum, p) => sum + p.netPaid, 0);

  const tabs = [
    { key: "overview", label: tp("overview") },
    { key: "students", label: ts("title"), count: assignedStudents.length },
    { key: "sessions", label: tp("sessions"), count: sessions.length },
    // The money tabs only exist for someone allowed to read them; the bodies
    // below re-check, so a typed ?tab=payouts gets nothing either.
    ...(canSeePay
      ? [
          { key: "payments", label: tp("payments"), count: payments.length },
          { key: "payouts", label: tp("payouts"), count: payouts.length },
          { key: "statement", label: tp("statement") },
        ]
      : []),
    { key: "availability", label: ta("tab"), count: availability.length },
  ];

  return (
    <div>
      <PageHeader
        title={fullName(teacher, locale)}
        description={`${referenceCode("teacher", teacher.referenceNo)} · ${t("commissionPct")}: ${toNumber(teacher.commissionPct)}% · ${
          teacher.paymentMode ? tm(teacher.paymentMode as "SESSION") : t("paymentModeDefault")
        }`}
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("hoursTaught")} value={formatHours(earnings?.hours ?? 0)} icon={Clock} />
        {canSeePay && (
          <>
            <StatCard label={t("expectedIncome")} value={formatMoney(earnings?.expected ?? 0)} suffix={currency} icon={TrendingUp} />
            <StatCard label={t("collectedIncome")} value={formatMoney(earnings?.collected ?? 0)} suffix={currency} icon={TrendingDown} tone="success" />
          </>
        )}
        {/* What we owe, on whichever basis the centre pays on. Reading
            dueCommission here would contradict the payroll run the moment a
            centre switches to Expected. */}
        {canSeePay && (
          <StatCard label={t("commissionDue")} value={formatMoney(earnings?.payableCommission ?? 0)} suffix={currency} icon={Wallet} tone="primary" />
        )}
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

          {canSeePay && (
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
          )}
        </div>
      )}

      {tab === "students" && (
        <div className="rounded-lg border border-border bg-card p-2">
          {assignedStudents.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{tc("noData")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {assignedStudents.map((student) => (
                <li key={student.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                  <Link href={`/students/${student.id}`} className="font-medium text-primary hover:underline">
                    {fullName(student, locale)}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {student.gradeLevel
                      ? locale === "ar"
                        ? student.gradeLevel.nameAr
                        : student.gradeLevel.nameEn
                      : "—"}
                  </span>
                  <Badge variant={student.active ? "success" : "muted"}>
                    {student.active ? tc("active") : tc("inactive")}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "sessions" && (
        <SessionsTable rows={sessions} currency={currency} hideTeacher linkStudents linkSessions />
      )}
      {canSeePay && tab === "payments" && (
        <PaymentsTable rows={payments} currency={currency} linkStudents linkTeachers linkReceipts />
      )}
      {canSeePay && tab === "payouts" && <PayoutsTable rows={payouts} currency={currency} />}
      {tab === "statement" && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle>{tp("statement")}</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <SendStatementButton kind="teacher" id={id} />
              <Link href={`/statement/teacher/${id}`}>
                <Button size="sm" className="gap-1">
                  <FileText className="size-4" />
                  {tp("openStatement")}
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label={t("hoursTaught")} value={formatHours(earnings?.hours ?? 0)} />
            <Row label={t("expectedIncome")} value={`${formatMoney(earnings?.expected ?? 0)} ${currency}`} />
            <Row label={t("collectedIncome")} value={`${formatMoney(earnings?.collected ?? 0)} ${currency}`} />
            <Row label={t("commissionDue")} value={`${formatMoney(earnings?.payableCommission ?? 0)} ${currency}`} />
            <Row label={tp("payouts")} value={`− ${formatMoney(paidOut)} ${currency}`} />
            <div className="border-t border-border pt-2">
              <Row
                label={t("netPayable")}
                value={`${formatMoney((earnings?.payableCommission ?? 0) - paidOut)} ${currency}`}
              />
            </div>
          </CardContent>
        </Card>
      )}

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
