"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { toNumber } from "@/lib/money";
import { displayName } from "@/lib/names";

export type TimetableEntry = {
  date: string;
  startMin: number;
  hours: number;
  /** The other party: the teacher on a student's sheet, the student on a teacher's. */
  counterpart: string;
  levelLabel: string;
  location: "CENTER" | "HOME";
  homeCode: string | null;
  status: string;
};

export type TimetablePerson = {
  id: string;
  name: string;
  entries: TimetableEntry[];
};

export type TimetableResult =
  | { ok: true; people: TimetablePerson[] }
  | { ok: false; error: string };

/**
 * Sessions for a set of students or teachers over a date range.
 *
 * Fetched on demand rather than shipped with the planner page: a week of
 * sessions for every student is far more than the planner itself needs, and
 * timetables are printed occasionally, not on every visit.
 */
export async function timetableData(
  locale: string,
  input: {
    kind: "student" | "teacher";
    ids: string[];
    /** Inclusive, YYYY-MM-DD. */
    from: string;
    /** Inclusive, YYYY-MM-DD. */
    to: string;
  },
): Promise<TimetableResult> {
  const session = await getSession();
  if (!session || !STAFF_ROLES.includes(session.role)) return { ok: false, error: "forbidden" };

  const ids = input.ids.filter(Boolean).slice(0, 200);
  if (ids.length === 0) return { ok: false, error: "noSelection" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to)) {
    return { ok: false, error: "invalid" };
  }

  const gte = new Date(`${input.from}T00:00:00.000Z`);
  const lt = new Date(`${input.to}T00:00:00.000Z`);
  lt.setUTCDate(lt.getUTCDate() + 1); // `to` is inclusive

  const isStudent = input.kind === "student";

  const sessions = await db.session.findMany({
    where: {
      date: { gte, lt },
      // Drafts are the planner's own scratch space and cancellations are not a
      // plan — neither belongs on a timetable handed to a family.
      status: { notIn: ["DRAFT", "CANCELLED"] },
      ...(isStudent ? { studentId: { in: ids } } : { teacherId: { in: ids } }),
    },
    include: { student: true, teacher: true, gradeLevel: true },
    orderBy: { date: "asc" },
  });

  const owners = isStudent
    ? await db.student.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } })
    : await db.teacher.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } });

  const byOwner = new Map<string, TimetableEntry[]>();
  for (const o of owners) byOwner.set(o.id, []);

  for (const s of sessions) {
    const ownerId = isStudent ? s.studentId : s.teacherId;
    if (!ownerId || !byOwner.has(ownerId)) continue;
    const other = isStudent ? s.teacher : s.student;
    byOwner.get(ownerId)!.push({
      date: s.date.toISOString().slice(0, 10),
      startMin: s.date.getUTCHours() * 60 + s.date.getUTCMinutes(),
      hours: toNumber(s.hours),
      counterpart: other ? displayName(other, locale) : "",
      levelLabel: locale === "ar" ? s.gradeLevel.nameAr : s.gradeLevel.nameEn,
      location: s.location as "CENTER" | "HOME",
      homeCode: s.student.homeCode,
      status: s.status,
    });
  }

  return {
    ok: true,
    // Everyone selected gets a page, including those with an empty week — an
    // absent sheet reads as "forgotten", an empty one reads as "no lessons".
    people: owners.map((o) => ({
      id: o.id,
      name: displayName(o, locale),
      entries: (byOwner.get(o.id) ?? []).sort(
        (a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin,
      ),
    })),
  };
}
