import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireRole } from "@/lib/rbac";
import { STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { displayName } from "@/lib/names";
import { formatMoney, toNumber } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bus, CalendarClock, CreditCard, UserCheck } from "lucide-react";

const hhmm = (d: Date) => d.toISOString().slice(11, 16);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const minToHHMM = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-medium">{children}</span>
    </div>
  );
}

/** Session 360 — everything one lesson touches: who, when, money, attendance,
 *  and the ride that serves it. */
export default async function SessionProfilePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);
  const t = await getTranslations("session360");
  const ts = await getTranslations("sessions");
  const te = await getTranslations("enums");
  const tc = await getTranslations("common");

  const s = await db.session.findUnique({
    where: { id },
    include: {
      student: true,
      teacher: true,
      subject: true,
      gradeLevel: true,
      group: true,
      allocations: { include: { payment: true } },
      tripStops: {
        include: { trip: { include: { driver: { include: { employee: true } }, vehicle: true } } },
        orderBy: { seq: "asc" },
      },
    },
  });
  if (!s) notFound();

  const currencyRow = await db.setting.findUnique({ where: { key: "currency" } });
  const currency = currencyRow?.value ?? "QAR";
  const label = (ar: string, en: string) => (locale === "ar" ? ar : en);

  const paid = s.allocations.reduce((a, x) => a + toNumber(x.amount), 0);
  const trips = [...new Map(s.tripStops.map((st) => [st.trip.id, st.trip])).values()];

  const statusTone: Record<string, "success" | "warning" | "muted" | "default"> = {
    COMPLETED: "success",
    CHECKED_IN: "default",
    SCHEDULED: "default",
    DRAFT: "muted",
    NO_SHOW: "warning",
    CANCELLED: "muted",
  };

  return (
    <div>
      <PageHeader
        title={`${displayName(s.student, locale)} — ${ymd(s.date)} ${hhmm(s.date)}`}
        description={[
          s.teacher ? displayName(s.teacher, locale) : null,
          s.subject ? label(s.subject.nameAr, s.subject.nameEn) : null,
          te(`location.${s.location as "CENTER"}`),
        ].filter(Boolean).join(" · ")}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Badge variant={statusTone[s.status] ?? "default"}>{te(`sessionStatus.${s.status as "SCHEDULED"}`)}</Badge>
        <Badge variant={s.paymentStatus === "PAID" ? "success" : s.paymentStatus === "PARTIAL" ? "warning" : "muted"}>
          {te(`paymentStatus.${s.paymentStatus as "PAID"}`)}
        </Badge>
        {s.isTrial && <Badge variant="muted">{ts("trial")}</Badge>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4" />
              {t("overview")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Row label={ts("student")}>
              <Link href={`/students/${s.studentId}`} className="text-primary hover:underline">
                {displayName(s.student, locale)}
              </Link>
            </Row>
            <Row label={ts("teacher")}>
              {s.teacher ? (
                <Link href={`/teachers/${s.teacherId}`} className="text-primary hover:underline">
                  {displayName(s.teacher, locale)}
                </Link>
              ) : "—"}
            </Row>
            <Row label={ts("gradeLevel")}>{label(s.gradeLevel.nameAr, s.gradeLevel.nameEn)}</Row>
            <Row label={ts("subject")}>{s.subject ? label(s.subject.nameAr, s.subject.nameEn) : "—"}</Row>
            {s.group && (
              <Row label={t("group")}>
                <Link href={`/groups/${s.groupId}`} className="text-primary hover:underline">{s.group.name}</Link>
              </Row>
            )}
            <Row label={tc("date")}><span dir="ltr">{ymd(s.date)}</span></Row>
            <Row label={t("time")}><span dir="ltr">{hhmm(s.date)}</span></Row>
            <Row label={t("hours")}><span dir="ltr">{toNumber(s.hours)}</span></Row>
            <Row label={t("pricePerHour")}><span dir="ltr">{formatMoney(toNumber(s.pricePerHour))} {currency}</span></Row>
            <Row label={t("total")}><span dir="ltr">{formatMoney(toNumber(s.total))} {currency}</span></Row>
            {s.notes && <Row label={tc("notes")}>{s.notes}</Row>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCheck className="size-4" />
              {t("attendance")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Row label={t("studentCheckIn")}>{s.studentCheckInAt ? <span dir="ltr">{hhmm(s.studentCheckInAt)}</span> : "—"}</Row>
            <Row label={t("studentCheckOut")}>{s.studentCheckOutAt ? <span dir="ltr">{hhmm(s.studentCheckOutAt)}</span> : "—"}</Row>
            <Row label={t("teacherCheckIn")}>{s.teacherCheckInAt ? <span dir="ltr">{hhmm(s.teacherCheckInAt)}</span> : "—"}</Row>
            <Row label={t("method")}>{s.checkInMethod ? te(`checkinMethod.${s.checkInMethod as "KIOSK"}`) : "—"}</Row>
            <Row label={t("actualHours")}>{s.actualHours != null ? <span dir="ltr">{toNumber(s.actualHours)}</span> : "—"}</Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="size-4" />
              {t("payments")} · <span dir="ltr">{formatMoney(paid)} / {formatMoney(toNumber(s.total))} {currency}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {s.allocations.length === 0 ? (
              <p className="text-muted-foreground">{t("noPayments")}</p>
            ) : (
              <ul className="space-y-1">
                {s.allocations.map((a) => (
                  <li key={a.id} className="flex items-baseline justify-between gap-2">
                    <span className="text-muted-foreground tabular-nums" dir="ltr">
                      {ymd(a.payment.date)} · {a.payment.receiptNo}
                    </span>
                    <span className="font-medium tabular-nums" dir="ltr">{formatMoney(toNumber(a.amount))} {currency}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bus className="size-4" />
              {t("transport")}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {trips.length === 0 ? (
              <p className="text-muted-foreground">{t("noTrip")}</p>
            ) : (
              <ul className="space-y-2">
                {trips.map((tr) => (
                  <li key={tr.id} className="flex flex-wrap items-center gap-2">
                    <Badge variant="muted">{te(`tripStatus.${tr.status as "PROPOSED"}`)}</Badge>
                    <span className="tabular-nums" dir="ltr">{minToHHMM(tr.plannedStartMin)}–{minToHHMM(tr.plannedEndMin)}</span>
                    <span className="font-medium">{tr.driver ? displayName(tr.driver.employee, locale) : t("noDriver")}</span>
                    {tr.vehicle && <span className="text-muted-foreground" dir="ltr">· {tr.vehicle.plate}</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
