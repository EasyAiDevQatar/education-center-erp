import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, ACADEMIC_ROLES, CALENDAR_VIEW_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { loadGroupOpts } from "@/lib/groups";
import { tripsBySession } from "@/lib/session-trips";
import { transportEnabled } from "@/lib/transport/settings";
import { toNumber } from "@/lib/money";
import { currentPriceMatrix } from "@/lib/pricing";
import { PageHeader } from "@/components/page-header";
import { CalendarClient, type CalEvent, type CalendarView } from "./calendar-client";
import type { PriceMatrix } from "../sessions/session-dialog";
import { displayName } from "@/lib/names";

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
  const session = await requireRole(locale, CALENDAR_VIEW_ROLES);
  // Read is wider than write. Everyone here can see the week; only the roles
  // that own the timetable get the affordances that change it.
  const canEdit = (ACADEMIC_ROLES as readonly string[]).includes(session.role);

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
  // Assignments are per academic year; unscoped until a year exists.
  const currentYear = await db.academicYear.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });

  const teacherFilter = get("teacher");
  const studentFilter = get("student");
  const locationFilter = ["CENTER", "HOME"].includes(get("location")) ? get("location") : "";

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

  const [sessions, students, teachers, levels, matrix, settingsRows, subjectList, teacherSubjectRows, groups] =
    await Promise.all([
      db.session.findMany({
        where: {
          date: { gte: rangeStart, lt: rangeEnd },
          ...(teacherFilter ? { teacherId: teacherFilter } : {}),
          ...(locationFilter ? { location: locationFilter } : {}),
        },
        include: {
          student: { include: { guardian: true } },
          teacher: true,
          gradeLevel: true,
          subject: true,
          group: { select: { name: true } },
        },
        orderBy: { date: "asc" },
      }),
      db.student.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        include: { teachers: { where: { academicYearId: currentYear?.id ?? null } } },
      }),
      db.teacher.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      db.gradeLevel.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
      currentPriceMatrix(),
      db.setting.findMany({ where: { key: { in: ["currency", "centerName", "centerLat", "centerLng"] } } }),
      db.subject.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { nameAr: "asc" }],
      }),
      db.teacherSubject.findMany({ select: { teacherId: true, subjectId: true } }),
      loadGroupOpts(),
    ]);

  const settingsMap = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
  const currency = settingsMap.currency ?? "QAR";
  const tripMap = (await transportEnabled())
    ? await tripsBySession(sessions.map((s) => s.id), locale)
    : {};
  const centreLat = parseFloat(settingsMap.centerLat ?? "");
  const centreLng = parseFloat(settingsMap.centerLng ?? "");
  const centre =
    Number.isFinite(centreLat) && Number.isFinite(centreLng)
      ? { lat: centreLat, lng: centreLng }
      : null;
  const label = (ar: string, en: string) => (locale === "ar" ? ar : en);

  const individualEvents = sessions.map((s) => {
    const start = s.date; // stored as UTC wall-clock
    const event: CalEvent = {
      id: s.id,
      day: start.toISOString().slice(0, 10),
      startMinutes: start.getUTCHours() * 60 + start.getUTCMinutes(),
      hours: toNumber(s.hours),
      studentId: s.studentId,
      studentName: displayName(s.student, locale),
      teacherId: s.teacherId,
      teacherName: s.teacher ? displayName(s.teacher, locale) : "",
      gradeLevelId: s.gradeLevelId,
      levelLabel: label(s.gradeLevel.nameAr, s.gradeLevel.nameEn),
      location: s.location as "CENTER" | "HOME",
      status: s.status,
      paymentStatus: s.paymentStatus,
      total: toNumber(s.total),
      guardianPhone: s.student.guardian?.phone ?? null,
      addressLabel: s.student.homeCode ?? s.student.address ?? null,
      home:
        s.student.homeLat != null && s.student.homeLng != null
          ? { lat: s.student.homeLat, lng: s.student.homeLng }
          : null,
      trip: tripMap[s.id] ?? null,
      subjectId: s.subjectId,
      subjectLabel: s.subject ? label(s.subject.nameAr, s.subject.nameEn) : null,
      group: null,
    };
    // New rows use bookingBatchId. Saved-group bookings made before that field
    // existed still group safely when every scheduling dimension is identical.
    const groupKey = s.bookingBatchId
      ? `batch:${s.bookingBatchId}`
      : s.groupId
        ? `legacy:${s.groupId}:${s.date.toISOString()}:${s.teacherId ?? ""}:${s.hours}:${s.location}`
        // Old ad-hoc group bookings have no saved group id, but every row from
        // their transaction has the exact same createdAt and schedule. This is
        // intentionally stricter than grouping by time alone.
        : `legacy-batch:${s.createdAt.getTime()}:${s.date.toISOString()}:${s.teacherId ?? ""}:${s.hours}:${s.location}`;
    return { event, groupKey, groupName: s.group?.name ?? null };
  });

  const grouped = new Map<string, typeof individualEvents>();
  const events: CalEvent[] = [];
  for (const item of individualEvents) {
    if (!item.groupKey) events.push(item.event);
    else {
      const bucket = grouped.get(item.groupKey);
      if (bucket) bucket.push(item);
      else grouped.set(item.groupKey, [item]);
    }
  }
  for (const [key, items] of grouped) {
    if (items.length < 2) {
      events.push(items[0].event);
      continue;
    }
    const first = items[0].event;
    const activeItems = items.filter((item) => item.event.status !== "CANCELLED");
    const displayedItems = activeItems.length > 0 ? activeItems : items;
    const statuses = new Set(displayedItems.map((item) => item.event.status));
    const paymentStatuses = new Set(displayedItems.map((item) => item.event.paymentStatus));
    events.push({
      ...first,
      id: `group:${key}`,
      studentName: items.map((item) => item.event.studentName).join(", "),
      status: statuses.size === 1 ? first.status : "MIXED",
      paymentStatus: paymentStatuses.size === 1 ? first.paymentStatus : "MIXED",
      total: displayedItems.reduce((sum, item) => sum + item.event.total, 0),
      group: {
        key,
        name: items[0].groupName,
        members: items.map(({ event }) => ({
          id: event.id,
          studentId: event.studentId,
          studentName: event.studentName,
          levelLabel: event.levelLabel,
          status: event.status,
          paymentStatus: event.paymentStatus,
          total: event.total,
        })),
      },
    });
  }
  const visibleEvents = studentFilter
    ? events.filter(
        (event) =>
          event.studentId === studentFilter ||
          event.group?.members.some((member) => member.studentId === studentFilter),
      )
    : events;

  const matrixMap: PriceMatrix = Object.fromEntries(
    matrix.map((m) => [m.gradeLevel.id, { CENTER: m.CENTER, HOME: m.HOME }]),
  );
  const studentOpts = students.map((s) => ({
    id: s.id,
    name: displayName(s, locale),
    gradeLevelId: s.gradeLevelId,
    gradeYear: s.gradeYear,
    teacherIds: s.teachers.map((x) => x.teacherId),
    studyLocation: s.studyLocation as "CENTER" | "HOME",
  }));
  const teacherOpts = teachers.map((tt) => ({ id: tt.id, label: displayName(tt, locale) }));
  const subjectOpts = subjectList.map((sbj) => ({ id: sbj.id, label: label(sbj.nameAr, sbj.nameEn) }));
  const teacherSubjectIds: Record<string, string[]> = {};
  for (const r of teacherSubjectRows) (teacherSubjectIds[r.teacherId] ??= []).push(r.subjectId);
  const levelOpts = levels.map((l) => ({ id: l.id, label: label(l.nameAr, l.nameEn) }));

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <CalendarClient
        canEdit={canEdit}
        view={view}
        anchor={anchorStr}
        days={days}
        events={visibleEvents}
        currency={currency}
        students={studentOpts}
        teachers={teacherOpts}
        levels={levelOpts}
        matrix={matrixMap}
        subjects={subjectOpts}
        teacherSubjectIds={teacherSubjectIds}
        groups={groups}
        teacherFilter={teacherFilter}
        studentFilter={studentFilter}
        locationFilter={locationFilter}
        centre={centre}
        centerName={settingsMap.centerName ?? ""}
      />
    </div>
  );
}
