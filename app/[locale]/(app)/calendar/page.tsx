import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { currentPriceMatrix } from "@/lib/pricing";
import { PageHeader } from "@/components/page-header";
import { CalendarClient, type CalEvent, type CalendarView } from "./calendar-client";
import type { PriceMatrix } from "../sessions/session-dialog";

/** Gulf week starts on Saturday. */
const WEEK_START_DOW = 6;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
/** Parse a YYYY-MM-DD as a UTC date (wall-clock == storage convention). */
function parseUTC(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

export default async function CalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);

  const t = await getTranslations("calendar");
  const sp = await searchParams;
  const get = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const view = (["day", "compact", "list"] as const).includes(get("view") as never)
    ? (get("view") as CalendarView)
    : "week";
  const anchorStr = /^\d{4}-\d{2}-\d{2}$/.test(get("date"))
    ? get("date")
    : ymd(new Date());
  const anchor = parseUTC(anchorStr);
  const teacherFilter = get("teacher");
  const studentFilter = get("student");

  // Build the visible day columns.
  let days: string[];
  if (view === "day") {
    days = [anchorStr];
  } else {
    const back = (anchor.getUTCDay() - WEEK_START_DOW + 7) % 7;
    const weekStart = addDays(anchor, -back);
    days = Array.from({ length: 7 }, (_, i) => ymd(addDays(weekStart, i)));
  }

  const rangeStart = parseUTC(days[0]);
  const rangeEnd = addDays(parseUTC(days[days.length - 1]), 1);

  const [sessions, students, teachers, levels, matrix, settingsRows] =
    await Promise.all([
      db.session.findMany({
        where: {
          date: { gte: rangeStart, lt: rangeEnd },
          ...(teacherFilter ? { teacherId: teacherFilter } : {}),
          ...(studentFilter ? { studentId: studentFilter } : {}),
        },
        include: { student: true, teacher: true, gradeLevel: true },
        orderBy: { date: "asc" },
      }),
      db.student.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      db.teacher.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      db.gradeLevel.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
      currentPriceMatrix(),
      db.setting.findMany({ where: { key: { in: ["currency", "centerName"] } } }),
    ]);

  const settingsMap = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
  const currency = settingsMap.currency ?? "QAR";
  const label = (ar: string, en: string) => (locale === "ar" ? ar : en);

  const events: CalEvent[] = sessions.map((s) => {
    const start = s.date; // stored as UTC wall-clock
    return {
      id: s.id,
      day: start.toISOString().slice(0, 10),
      startMinutes: start.getUTCHours() * 60 + start.getUTCMinutes(),
      hours: toNumber(s.hours),
      studentId: s.studentId,
      studentName: s.student.name,
      teacherId: s.teacherId,
      teacherName: s.teacher.name,
      gradeLevelId: s.gradeLevelId,
      levelLabel: label(s.gradeLevel.nameAr, s.gradeLevel.nameEn),
      location: s.location as "CENTER" | "HOME",
      status: s.status,
      paymentStatus: s.paymentStatus,
      total: toNumber(s.total),
    };
  });

  const matrixMap: PriceMatrix = Object.fromEntries(
    matrix.map((m) => [m.gradeLevel.id, { CENTER: m.CENTER, HOME: m.HOME }]),
  );
  const studentOpts = students.map((s) => ({ id: s.id, name: s.name, gradeLevelId: s.gradeLevelId }));
  const teacherOpts = teachers.map((tt) => ({ id: tt.id, label: tt.name }));
  const levelOpts = levels.map((l) => ({ id: l.id, label: label(l.nameAr, l.nameEn) }));

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <CalendarClient
        view={view}
        anchor={anchorStr}
        days={days}
        events={events}
        currency={currency}
        students={studentOpts}
        teachers={teacherOpts}
        levels={levelOpts}
        matrix={matrixMap}
        teacherFilter={teacherFilter}
        studentFilter={studentFilter}
        centerName={settingsMap.centerName ?? ""}
      />
    </div>
  );
}
