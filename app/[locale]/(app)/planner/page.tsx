import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
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

export default async function PlannerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);

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
        where: { date: { gte: start, lt: end } },
        include: { student: true, gradeLevel: true },
        orderBy: { date: "asc" },
      }),
      db.teacher.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      db.student.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      db.gradeLevel.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
      currentPriceMatrix(),
      db.setting.findMany({
        where: {
          key: { in: ["currency", "plannerDayStart", "plannerHomeGapMin", "centerName"] },
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
  const label = (ar: string, en: string) => (locale === "ar" ? ar : en);

  const rows: PlannerSession[] = sessions
    // The planner is teacher-row based, so an unassigned walk-in has nowhere
    // to sit; it shows on the calendar and the check-in board instead.
    .filter((s): s is typeof s & { teacherId: string } => s.teacherId !== null)
    .map((s) => ({
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
    isTrial: s.isTrial,
  }));

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
        }))}
        levels={levels.map((l) => ({ id: l.id, label: label(l.nameAr, l.nameEn) }))}
        matrix={matrixMap}
        currency={settings.currency ?? "QAR"}
        dayStartMin={hhmmToMin(settings.plannerDayStart ?? null)}
        homeGapMin={parseInt(settings.plannerHomeGapMin ?? "30", 10) || 0}
        availability={availability}
        templates={templateRows}
        centerName={settings.centerName ?? ""}
      />
    </div>
  );
}
