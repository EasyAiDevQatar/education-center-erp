"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { toNumber } from "@/lib/money";
import { findConflicts, weekdayOf, type Conflict } from "@/lib/conflicts";
import { hhmmToMin } from "@/lib/planner";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  hours: z.coerce.number().min(0.25).max(12),
  teacherId: z.string().min(1),
  studentIds: z.array(z.string().min(1)).min(1).max(60),
  /** Session being edited, so it can't clash with itself. */
  excludeId: z.string().optional().nullable(),
});

export type ConflictResult = { studentId: string; conflicts: Conflict[] };

function dayRange(date: string) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { gte: start, lt: end };
}

/**
 * Advisory conflict check for one or many students against the same slot.
 *
 * Loads only the target day plus the teacher's availability, then defers every
 * decision to the pure rules in `lib/conflicts.ts`.
 */
export async function checkConflicts(
  input: z.infer<typeof schema>,
): Promise<ConflictResult[]> {
  const s = await getSession();
  if (!s || !STAFF_ROLES.includes(s.role)) return [];

  const parsed = schema.safeParse(input);
  if (!parsed.success) return [];
  const d = parsed.data;

  const [sessions, availability] = await Promise.all([
    db.session.findMany({
      where: {
        date: dayRange(d.date),
        OR: [{ teacherId: d.teacherId }, { studentId: { in: d.studentIds } }],
      },
      include: { student: { select: { name: true } }, teacher: { select: { name: true } } },
    }),
    db.teacherAvailability.findMany({
      where: { teacherId: d.teacherId },
      select: { weekday: true, startMin: true, endMin: true },
    }),
  ]);

  const existing = sessions.map((x) => ({
    id: x.id,
    teacherId: x.teacherId,
    studentId: x.studentId,
    startMin: x.date.getUTCHours() * 60 + x.date.getUTCMinutes(),
    hours: toNumber(x.hours),
    status: x.status,
    studentName: x.student.name,
    teacherName: x.teacher?.name ?? "",
  }));

  const startMin = hhmmToMin(d.time, 0);
  const weekday = weekdayOf(d.date);

  return d.studentIds.map((studentId) => ({
    studentId,
    conflicts: findConflicts({
      candidate: {
        id: d.excludeId ?? null,
        teacherId: d.teacherId,
        studentId,
        weekday,
        startMin,
        hours: d.hours,
      },
      existing,
      availability,
    }),
  }));
}
