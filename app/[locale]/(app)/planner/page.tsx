import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, ACADEMIC_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { currentPriceMatrix } from "@/lib/pricing";
import { hhmmToMin } from "@/lib/planner";
import { PageHeader } from "@/components/page-header";
import {
  PlannerClient,
  type PlannerSession,
  type PlannerTemplateRow,
} from "./planner-client";
import type { PriceMatrix } from "../sessions/session-dialog";
import { displayName } from "@/lib/names";
import { tripsBySession } from "@/lib/session-trips";
import { transportEnabled } from "@/lib/transport/settings";
import { groupOccurrenceKeys, sessionOccurrenceKey } from "@/lib/session-grouping";

export default async function PlannerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const auth = await requireRole(locale, ACADEMIC_ROLES);

  const t = await getTranslations("planner");
  const sp = await searchParams;
  const dParam = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const day =
    dParam && /^\d{4}-\d{2}-\d{2}$/.test(dParam)
      ? dParam
      : new Date().toISOString().slice(0, 10);

  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const [sessions, teachers, students, levels, matrix, settingsRows, availability, templates] =
    await Promise.all([
      db.session.findMany({
        where: { date: { gte: start, lt: end }, status: { not: "CANCELLED" } },
        include: {
          student: { include: { guardian: true } },
          gradeLevel: true,
          subject: true,
          group: { select: { name: true } },
        },
        orderBy: { date: "asc" },
      }),
      db.teacher.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      db.student.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      db.gradeLevel.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
      currentPriceMatrix(),
      db.setting.findMany({
        where: {
          key: { in: ["currency", "plannerDayStart", "plannerHomeGapMin", "centerName", "centerLogo", "centerLat", "centerLng"] },
        },
      }),
      db.teacherAvailability.findMany({
        select: { teacherId: true, weekday: true, startMin: true, endMin: true },
      }),
      db.plannerTemplate.findMany({
        where: { active: true },
        orderBy: [{ weekday: "asc" }, { startMin: "asc" }],
      }),
    ]);

  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  const tripMap = (await transportEnabled())
    ? await tripsBySession(sessions.map((s) => s.id), locale)
    : {};
  const centreLat = parseFloat(settings.centerLat ?? "");
  const centreLng = parseFloat(settings.centerLng ?? "");
  const centre =
    Number.isFinite(centreLat) && Number.isFinite(centreLng)
      ? { lat: centreLat, lng: centreLng }
      : null;
  const label = (ar: string, en: string) => (locale === "ar" ? ar : en);

  const plannerSessions = sessions
    // The planner is teacher-row based, so an unassigned walk-in has nowhere
    // to sit; it shows on the calendar and the check-in board instead.
    .filter((s): s is typeof s & { teacherId: string } => s.teacherId !== null);
  const realGroupKeys = groupOccurrenceKeys(plannerSessions);
  const keyedRows = plannerSessions.map((s) => ({
    source: s,
    key: sessionOccurrenceKey(s),
    row: {
      id: s.id,
      teacherId: s.teacherId,
      studentId: s.studentId,
      startMin: s.date.getUTCHours() * 60 + s.date.getUTCMinutes(),
      hours: toNumber(s.hours),
      studentName: displayName(s.student, locale),
      levelLabel: label(s.gradeLevel.nameAr, s.gradeLevel.nameEn),
      location: s.location as "CENTER" | "HOME",
      status: s.status,
      total: toNumber(s.total),
      homeCode: s.student.homeCode,
      subjectLabel: s.subject ? (locale === "ar" ? s.subject.nameAr : s.subject.nameEn) : null,
      isTrial: s.isTrial,
      paymentStatus: s.paymentStatus,
      guardianPhone: s.student.guardian?.phone ?? null,
      addressLabel: s.student.homeCode ?? s.student.address ?? null,
      home:
        s.student.homeLat != null && s.student.homeLng != null
          ? { lat: s.student.homeLat, lng: s.student.homeLng }
          : null,
      trip: tripMap[s.id] ?? null,
      group: null,
    } satisfies PlannerSession,
  }));

  const buckets = new Map<string, typeof keyedRows>();
  const rows: PlannerSession[] = [];
  for (const item of keyedRows) {
    if (!realGroupKeys.has(item.key)) {
      rows.push(item.row);
      continue;
    }
    const bucket = buckets.get(item.key);
    if (bucket) bucket.push(item);
    else buckets.set(item.key, [item]);
  }
  for (const [key, items] of buckets) {
    const first = items[0].row;
    const statuses = new Set(items.map((item) => item.row.status));
    const payments = new Set(items.map((item) => item.row.paymentStatus));
    const members = items.map(({ row }) => ({
      id: row.id,
      studentId: row.studentId,
      studentName: row.studentName,
      levelLabel: row.levelLabel,
      status: row.status,
      paymentStatus: row.paymentStatus,
      total: row.total,
    }));
    rows.push({
      ...first,
      id: `group:${key}`,
      studentName: members.map((member) => member.studentName).join(", "),
      levelLabel: [...new Set(members.map((member) => member.levelLabel))].join(", "),
      status: statuses.size === 1 ? first.status : "MIXED",
      paymentStatus: payments.size === 1 ? first.paymentStatus : "MIXED",
      total: members.reduce((sum, member) => sum + member.total, 0),
      homeCode: null,
      guardianPhone: null,
      addressLabel: null,
      home: null,
      trip: null,
      group: {
        key,
        name: items[0].source.group?.name ?? null,
        members,
      },
    });
  }

  const templateRows: PlannerTemplateRow[] = templates.map((x) => ({
    id: x.id,
    teacherId: x.teacherId,
    studentId: x.studentId,
    weekday: x.weekday,
    startMin: x.startMin,
    hours: toNumber(x.hours),
    location: x.location as "CENTER" | "HOME",
  }));

  const matrixMap: PriceMatrix = Object.fromEntries(
    matrix.map((m) => [m.gradeLevel.id, { CENTER: m.CENTER, HOME: m.HOME }]),
  );

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <PlannerClient
        day={day}
        sessions={rows}
        teachers={teachers.map((tt) => ({ id: tt.id, label: displayName(tt, locale) }))}
        students={students.map((st) => ({
          id: st.id,
          name: displayName(st, locale),
          gradeLevelId: st.gradeLevelId,
          studyLocation: st.studyLocation as "CENTER" | "HOME",
        }))}
        levels={levels.map((l) => ({ id: l.id, label: label(l.nameAr, l.nameEn) }))}
        matrix={matrixMap}
        currency={settings.currency ?? "QAR"}
        dayStartMin={hhmmToMin(settings.plannerDayStart ?? null)}
        homeGapMin={parseInt(settings.plannerHomeGapMin ?? "30", 10) || 0}
        availability={availability}
        templates={templateRows}
        centre={centre}
        centerName={settings.centerName ?? ""}
        centerLogo={settings.centerLogo ?? ""}
        printedBy={auth.name}
      />
    </div>
  );
}
