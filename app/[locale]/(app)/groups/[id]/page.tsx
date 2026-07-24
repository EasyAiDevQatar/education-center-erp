import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { formatMoney, toNumber } from "@/lib/money";
import { displayName } from "@/lib/names";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CalendarDays, Clock, Wallet, Users2 } from "lucide-react";

/**
 * Group 360 — one place linking everything a saved group ("course") touches:
 * its teacher, its members with their agreed prices, and every session booked
 * through it (sessions carry `groupId` when booked from a loaded group).
 */
export default async function GroupProfilePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);

  const t = await getTranslations("groups");
  const tc = await getTranslations("common");
  const te = await getTranslations("enums");

  const group = await db.studentGroup.findUnique({
    where: { id },
    include: {
      teacher: true,
      subject: true,
      gradeLevel: true,
      members: { include: { student: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!group) notFound();

  const [sessions, currencyRow] = await Promise.all([
    db.session.findMany({
      where: { groupId: id },
      include: { student: true },
      orderBy: { date: "desc" },
      take: 100,
    }),
    db.setting.findUnique({ where: { key: "currency" } }),
  ]);
  const currency = currencyRow?.value ?? "QAR";
  const label = (ar: string, en: string) => (locale === "ar" ? ar : en);

  // Money-facing totals exclude drafts/cancelled, same rule as everywhere else.
  const counted = sessions.filter((s) => !["DRAFT", "CANCELLED"].includes(s.status));
  const totalHours = counted.reduce((a, s) => a + toNumber(s.hours), 0);
  const totalRevenue = counted.reduce((a, s) => a + toNumber(s.total), 0);

  const defaultPrice =
    group.defaultPricePerHour === null ? null : toNumber(group.defaultPricePerHour);

  return (
    <div>
      <PageHeader
        title={group.name}
        description={[
          group.subject ? label(group.subject.nameAr, group.subject.nameEn) : null,
          group.gradeLevel ? label(group.gradeLevel.nameAr, group.gradeLevel.nameEn) : null,
          te(`location.${group.location as "CENTER"}`),
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("members")} value={String(group.members.length)} icon={Users2} />
        <StatCard label={t("sessionsCount")} value={String(counted.length)} icon={CalendarDays} />
        <StatCard label={t("totalHours")} value={totalHours.toFixed(1)} icon={Clock} />
        <StatCard
          label={t("revenue")}
          value={`${formatMoney(totalRevenue)} ${currency}`}
          icon={Wallet}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("roster")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex flex-wrap gap-2 text-sm">
              <span className="text-muted-foreground">{t("teacher")}:</span>
              {group.teacher ? (
                <Link href={`/teachers/${group.teacher.id}`} className="font-medium text-primary hover:underline">
                  {displayName(group.teacher, locale)}
                </Link>
              ) : (
                <span>—</span>
              )}
              <span className="ms-4 text-muted-foreground">{t("defaultPrice")}:</span>
              <span dir="ltr" className="tabular-nums">
                {defaultPrice != null ? `${formatMoney(defaultPrice)} ${currency}` : t("matrix")}
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tc("name")}</TableHead>
                  <TableHead>{t("gradeYearShort")}</TableHead>
                  <TableHead>{t("price")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.members.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      {t("noMembers")}
                    </TableCell>
                  </TableRow>
                )}
                {group.members.map((m) => {
                  const price =
                    m.pricePerHour === null ? null : toNumber(m.pricePerHour);
                  return (
                    <TableRow key={m.studentId}>
                      <TableCell>
                        <Link href={`/students/${m.studentId}`} className="font-medium text-primary hover:underline">
                          {displayName(m.student, locale)}
                        </Link>
                      </TableCell>
                      <TableCell>{m.student.gradeYear ?? "—"}</TableCell>
                      <TableCell className="tabular-nums" dir="ltr">
                        {price != null
                          ? `${formatMoney(price)} ${currency}`
                          : defaultPrice != null
                            ? `${formatMoney(defaultPrice)} ${currency}`
                            : t("matrix")}
                        {price == null && (
                          <span className="ms-1 text-xs text-muted-foreground">({t("inherited")})</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("groupSessions")}</CardTitle>
          </CardHeader>
          <CardContent>
            {sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noSessionsYet")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tc("date")}</TableHead>
                    <TableHead>{tc("name")}</TableHead>
                    <TableHead>{tc("status")}</TableHead>
                    <TableHead>{tc("amount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.slice(0, 30).map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="tabular-nums" dir="ltr">
                        {s.date.toISOString().slice(0, 10)}
                      </TableCell>
                      <TableCell>
                        <Link href={`/students/${s.studentId}`} className="hover:underline">
                          {displayName(s.student, locale)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.status === "COMPLETED" ? "success" : s.status === "CANCELLED" ? "muted" : "default"}>
                          {te(`sessionStatus.${s.status as "SCHEDULED"}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums" dir="ltr">
                        {formatMoney(toNumber(s.total))} {currency}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
