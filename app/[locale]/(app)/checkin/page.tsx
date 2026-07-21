import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { RosterBoard, type RosterItem } from "./roster-board";
import { displayName } from "@/lib/names";

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
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
  await requireRole(locale, STAFF_ROLES);

  const t = await getTranslations("checkin");
  const sp = await searchParams;
  const dParam = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const day = dParam && /^\d{4}-\d{2}-\d{2}$/.test(dParam) ? dParam : ymd(new Date());

  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(`${day}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  const [sessions, review, unassigned] = await Promise.all([
    db.session.findMany({
      // Planner drafts are pending confirmation — not attendance records.
      where: { date: { gte: start, lt: end }, status: { not: "DRAFT" } },
      include: { student: true, teacher: true },
      orderBy: { date: "asc" },
    }),
    // The review queue is deliberately NOT scoped to the shown day: an
    // auto-completion from last week still needs a human, and hiding it behind
    // date navigation is exactly how it would get missed.
    db.session.findMany({
      where: { autoCompleted: true },
      include: { student: true, teacher: true },
      orderBy: { date: "desc" },
      take: 50,
    }),
    // Same reasoning as the review queue: not scoped to the shown day, because
    // a walk-in from Tuesday still needs a teacher on Thursday.
    db.session.findMany({
      where: { needsTeacher: true },
      include: { student: true, teacher: true },
      orderBy: { date: "desc" },
      take: 50,
    }),
  ]);

  // Offer only teachers who actually worked that day — the realistic set, and
  // a guard against crediting someone who wasn't in the building.
  const dayTeachers = [
    ...new Map(
      sessions
        .filter((s) => s.teacher)
        .map((s) => [s.teacherId!, { id: s.teacherId!, label: displayName(s.teacher!, locale) }]),
    ).values(),
  ];

  type Row = (typeof sessions)[number];
  const toItem = (s: Row): RosterItem => ({
    id: s.id,
    teacherId: s.teacherId,
    teacherName: s.teacher ? displayName(s.teacher, locale) : "",
    studentName: displayName(s.student, locale),
    startMin: s.date.getUTCHours() * 60 + s.date.getUTCMinutes(),
    hours: toNumber(s.hours),
    location: s.location as "CENTER" | "HOME",
    status: s.status,
    autoCompleted: s.autoCompleted,
  });

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <RosterBoard
        day={day}
        items={sessions.map(toItem)}
        pendingReview={review.map(toItem)}
        needsTeacher={unassigned.map(toItem)}
        dayTeachers={dayTeachers}
      />
    </div>
  );
}
