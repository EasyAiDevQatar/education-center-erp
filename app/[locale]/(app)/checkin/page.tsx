import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, ACADEMIC_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import {
  RosterBoard,
  type AttendanceTab,
  type AttendanceView,
  type RosterItem,
} from "./roster-board";
import { displayName } from "@/lib/names";
import { centerClockTime, centerToday } from "@/lib/session-time";

const ATTENDANCE_TABS = ["attendance", "needs-teacher", "review"] as const;
const ATTENDANCE_VIEWS = ["list", "cards"] as const;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function dayRange(day: string) {
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export default async function CheckinPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, ACADEMIC_ROLES);

  const t = await getTranslations("checkin");
  const sp = await searchParams;
  const dParam = first(sp.date);
  const day = dParam && /^\d{4}-\d{2}-\d{2}$/.test(dParam) ? dParam : centerToday();
  const rawTab = first(sp.tab);
  const activeTab: AttendanceTab = ATTENDANCE_TABS.includes(rawTab as AttendanceTab)
    ? (rawTab as AttendanceTab)
    : "attendance";
  const rawView = first(sp.view);
  const activeView: AttendanceView = ATTENDANCE_VIEWS.includes(rawView as AttendanceView)
    ? (rawView as AttendanceView)
    : "list";
  const { start, end } = dayRange(day);

  const [sessions, review, unassigned] = await Promise.all([
    db.session.findMany({
      // Planner drafts are pending confirmation — not attendance records.
      where: { date: { gte: start, lt: end }, status: { not: "DRAFT" } },
      include: { student: true, teacher: true },
      orderBy: { date: "asc" },
    }),
    // Both queues stay global: hiding old work behind date navigation is how
    // unresolved sessions get forgotten. The dedicated tabs paginate them.
    db.session.findMany({
      where: { autoCompleted: true },
      include: { student: true, teacher: true },
      orderBy: { date: "desc" },
    }),
    db.session.findMany({
      where: { needsTeacher: true },
      include: { student: true, teacher: true },
      orderBy: { date: "desc" },
    }),
  ]);

  const queueDays = [...new Set(unassigned.map((s) => s.date.toISOString().slice(0, 10)))];
  const teacherWork = queueDays.length
    ? await db.session.findMany({
        where: {
          status: { in: ["CHECKED_IN", "COMPLETED"] },
          teacherId: { not: null },
          OR: queueDays.map((queueDay) => {
            const range = dayRange(queueDay);
            return { date: { gte: range.start, lt: range.end } };
          }),
        },
        include: { teacher: true },
        orderBy: { date: "asc" },
      })
    : [];

  // Each unresolved walk-in gets candidates from its own day, not whichever
  // date happens to be open in the first tab.
  const candidateMaps = new Map<string, Map<string, { id: string; label: string }>>();
  for (const work of teacherWork) {
    if (!work.teacher || !work.teacherId) continue;
    const workDay = work.date.toISOString().slice(0, 10);
    if (!candidateMaps.has(workDay)) candidateMaps.set(workDay, new Map());
    candidateMaps
      .get(workDay)!
      .set(work.teacherId, { id: work.teacherId, label: displayName(work.teacher, locale) });
  }
  const eligibleTeachersByDate = Object.fromEntries(
    [...candidateMaps].map(([queueDay, candidates]) => [
      queueDay,
      [...candidates.values()].sort((a, b) => a.label.localeCompare(b.label, locale)),
    ]),
  );

  type Row = (typeof sessions)[number];
  const toItem = (s: Row): RosterItem => ({
    id: s.id,
    sessionDate: s.date.toISOString().slice(0, 10),
    teacherId: s.teacherId,
    teacherName: s.teacher ? displayName(s.teacher, locale) : "",
    studentName: displayName(s.student, locale),
    startMin: s.date.getUTCHours() * 60 + s.date.getUTCMinutes(),
    hours: toNumber(s.hours),
    location: s.location as "CENTER" | "HOME",
    status: s.status,
    autoCompleted: s.autoCompleted,
    checkedInAt: s.studentCheckInAt ? centerClockTime(s.studentCheckInAt) : null,
    checkedOutAt: s.studentCheckOutAt ? centerClockTime(s.studentCheckOutAt) : null,
    checkInMethod: s.checkInMethod,
    actualHours: s.actualHours == null ? null : toNumber(s.actualHours),
  });

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <RosterBoard
        day={day}
        activeTab={activeTab}
        activeView={activeView}
        items={sessions.map(toItem)}
        pendingReview={review.map(toItem)}
        needsTeacher={unassigned.map(toItem)}
        eligibleTeachersByDate={eligibleTeachersByDate}
      />
    </div>
  );
}
