"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { toNumber } from "@/lib/money";
import { displayName } from "@/lib/names";
import { weekdayOf, type BusySession } from "@/lib/conflicts";
import { suggestFreeStart, suggestTeacher, type TeacherOption } from "@/lib/conflict-suggest";
import { hhmmToMin } from "@/lib/planner";

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  hours: z.coerce.number().min(0.25).max(12),
  teacherId: z.string().min(1),
  studentIds: z.array(z.string().min(1)).min(1).max(60),
  excludeId: z.string().optional().nullable(),
});

export type FixSuggestion = {
  /** A clean start time on the same day, "HH:MM", or null. */
  time: string | null;
  /** A teacher free at the original time — the UI resolves the display name. */
  teacherId: string | null;
};

function dayRange(date: string) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { gte: start, lt: end };
}
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * Propose a way out of a scheduling clash: an alternative time, an alternative
 * teacher, or both. Reads only the target day plus availability, then defers
 * the decision to the pure rules in lib/conflict-suggest.
 */
export async function suggestFix(input: z.infer<typeof schema>): Promise<FixSuggestion> {
  const s = await getSession();
  if (!s || !STAFF_ROLES.includes(s.role)) return { time: null, teacherId: null };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { time: null, teacherId: null };
  const d = parsed.data;

  // Every session on the day (small), so a teacher swap can see who else is
  // free, and every active teacher's availability.
  const [sessions, teachers, availability] = await Promise.all([
    db.session.findMany({
      where: { date: dayRange(d.date) },
      include: { student: { select: { name: true } }, teacher: true },
    }),
    db.teacher.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.teacherAvailability.findMany({ select: { teacherId: true, weekday: true, startMin: true, endMin: true } }),
  ]);

  const existing: BusySession[] = sessions.map((x) => ({
    id: x.id,
    teacherId: x.teacherId,
    studentId: x.studentId,
    startMin: x.date.getUTCHours() * 60 + x.date.getUTCMinutes(),
    hours: toNumber(x.hours),
    status: x.status,
    studentName: x.student.name,
    teacherName: x.teacher ? displayName(x.teacher, "en") : "",
  }));

  const weekday = weekdayOf(d.date);
  const startMin = hhmmToMin(d.time, 0);
  const mineAvail = availability.filter((a) => a.teacherId === d.teacherId);

  // Time move: same teacher, nearest clean slot on the day.
  const freeStart = suggestFreeStart({
    preferMin: startMin,
    hours: d.hours,
    teacherId: d.teacherId,
    studentIds: d.studentIds,
    weekday,
    existing,
    availability: mineAvail,
    excludeId: d.excludeId ?? null,
  });

  // Teacher swap: keep the time, find a colleague who is free.
  const byTeacher = new Map<string, TeacherOption>();
  for (const tt of teachers) byTeacher.set(tt.id, { teacherId: tt.id, availability: [] });
  for (const a of availability) {
    const opt = byTeacher.get(a.teacherId);
    if (opt) opt.availability!.push({ weekday: a.weekday, startMin: a.startMin, endMin: a.endMin });
  }
  const altTeacherId = suggestTeacher({
    candidates: [...byTeacher.values()],
    excludeTeacherId: d.teacherId,
    studentIds: d.studentIds,
    startMin,
    hours: d.hours,
    weekday,
    existing,
    excludeId: d.excludeId ?? null,
  });
  return {
    time: freeStart === null ? null : toHHMM(freeStart),
    teacherId: altTeacherId,
  };
}