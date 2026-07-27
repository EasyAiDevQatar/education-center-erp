import "server-only";
import { db } from "./db";
import { toNumber } from "./money";

/**
 * Nobody can be in two places at once.
 *
 * The booking screens have warned about clashes for a long time, but the warning
 * was the whole enforcement: `saveSession` validated, priced and wrote. So the
 * server would cheerfully record one teacher at two different homes at 16:00,
 * and the seeder — which asks nothing — produced them by the dozen.
 *
 * This is the refusal. It is deliberately NOT behind the transport spacing
 * setting: that one answers "is there time to drive between these?", a question
 * about minutes. This one answers "is this the same hour?", which is not a
 * policy the centre gets to switch off.
 */

/** Half-open [start, start+hours) overlap. Touching ends do not overlap. */
export function windowsOverlap(
  aStart: Date,
  aHours: number,
  bStart: Date,
  bHours: number,
): boolean {
  const aEnd = aStart.getTime() + aHours * 3_600_000;
  const bEnd = bStart.getTime() + bHours * 3_600_000;
  return aStart.getTime() < bEnd && bStart.getTime() < aEnd;
}

/** Statuses that no longer occupy anybody's time. */
const INERT = ["CANCELLED", "DRAFT"];

export type OverlapClash = {
  /** Whose diary is double-booked. */
  kind: "TEACHER" | "STUDENT";
  sessionId: string;
  studentName: string;
  teacherName: string;
  startsAt: Date;
  hours: number;
};

/**
 * The session already in the diary that blocks this one, or null.
 *
 * A group lesson is the one legitimate way a teacher has two students in the
 * same hour, so same-teacher overlaps are allowed when both rows belong to the
 * same group. A student is never exempt: one child cannot attend two lessons.
 */
export async function findBlockingOverlap(input: {
  /** Null when creating; set when editing, so a row never clashes with itself. */
  id: string | null;
  teacherId: string | null;
  studentId: string;
  date: Date;
  hours: number;
  groupId: string | null;
}): Promise<OverlapClash | null> {
  const { id, teacherId, studentId, date, hours, groupId } = input;
  // A day either side covers any sane lesson length without scanning the table.
  const from = new Date(date.getTime() - 24 * 3_600_000);
  const to = new Date(date.getTime() + 24 * 3_600_000);

  const candidates = await db.session.findMany({
    where: {
      id: id ? { not: id } : undefined,
      status: { notIn: INERT },
      date: { gte: from, lte: to },
      OR: [{ studentId }, ...(teacherId ? [{ teacherId }] : [])],
    },
    include: { student: { select: { name: true } }, teacher: { select: { name: true } } },
  });

  for (const c of candidates) {
    if (!windowsOverlap(date, hours, c.date, toNumber(c.hours))) continue;

    const sameStudent = c.studentId === studentId;
    const sameTeacher = !!teacherId && c.teacherId === teacherId;
    // Two rows of one group class: the teacher is in one room with both.
    const sameGroup = !!groupId && c.groupId === groupId;

    if (sameStudent || (sameTeacher && !sameGroup)) {
      return {
        kind: sameStudent ? "STUDENT" : "TEACHER",
        sessionId: c.id,
        studentName: c.student?.name ?? "",
        teacherName: c.teacher?.name ?? "",
        startsAt: c.date,
        hours: toNumber(c.hours),
      };
    }
  }
  return null;
}
