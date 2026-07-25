"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { toNumber } from "@/lib/money";
import { findConflicts, weekdayOf, type Conflict } from "@/lib/conflicts";
import { hhmmToMin } from "@/lib/planner";
import { loadTransportConfig } from "@/lib/transport/settings";
import { spacingProblems, suggestStart, type SpacedSession } from "@/lib/transport/spacing";

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

/* -------- Transport spacing (a separate question from "do they clash") ---- */

const spacingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  hours: z.coerce.number().min(0.25).max(12),
  teacherId: z.string().min(1),
  location: z.enum(["CENTER", "HOME"]),
  excludeId: z.string().optional().nullable(),
});

export type SpacingCheck = {
  problems: {
    kind: "OVERLAP" | "TOO_TIGHT";
    shortfallMin: number;
    requiredGapMin: number;
    otherLabel: string;
    otherStartMin: number;
    otherEndMin: number;
    otherLocation: string;
  }[];
  /** Minutes-from-midnight of the nearest start that clears everything. */
  suggestedStartMin: number | null;
  /** True when the centre has chosen to refuse such a booking outright. */
  blocking: boolean;
};

/**
 * Is there room around this lesson for the journeys it implies?
 *
 * Deliberately NOT folded into checkConflicts. That answers "is the teacher
 * double-booked", advisorily, and three callers depend on its shape. This
 * answers "can anybody physically get there", which for a home visit is not
 * advice — it is the difference between a plan and a leg no car can drive.
 */
export async function checkSpacing(
  input: z.infer<typeof spacingSchema>,
): Promise<SpacingCheck> {
  const empty: SpacingCheck = { problems: [], suggestedStartMin: null, blocking: false };
  const s = await getSession();
  if (!s || !STAFF_ROLES.includes(s.role)) return empty;

  const parsed = spacingSchema.safeParse(input);
  if (!parsed.success) return empty;
  const d = parsed.data;

  const config = await loadTransportConfig();
  if (!config.enabled) return empty; // no transport module, no journeys to fit

  const rows = await db.session.findMany({
    where: {
      date: dayRange(d.date),
      teacherId: d.teacherId,
      // A cancelled lesson blocks nothing, and a no-show already happened.
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
    },
    include: { student: { select: { name: true } } },
  });

  const existing: SpacedSession[] = rows
    .filter((x) => x.id !== d.excludeId)
    .map((x) => {
      const startMin = x.date.getUTCHours() * 60 + x.date.getUTCMinutes();
      return {
        id: x.id,
        startMin,
        endMin: startMin + Math.round(toNumber(x.hours) * 60),
        location: x.location,
      };
    });

  const startMin = hhmmToMin(d.time, 0);
  const candidate: SpacedSession = {
    id: d.excludeId ?? null,
    startMin,
    endMin: startMin + Math.round(d.hours * 60),
    location: d.location,
  };

  const byId = new Map(rows.map((r) => [r.id, r]));
  const found = spacingProblems(candidate, existing, config.spacing);

  return {
    problems: found.map((p) => {
      const other = p.otherId ? byId.get(p.otherId) : null;
      const otherStart = other
        ? other.date.getUTCHours() * 60 + other.date.getUTCMinutes()
        : 0;
      return {
        kind: p.kind,
        shortfallMin: p.shortfallMin,
        requiredGapMin: p.requiredGapMin,
        otherLabel: other?.student.name ?? "",
        otherStartMin: otherStart,
        otherEndMin: otherStart + Math.round(toNumber(other?.hours ?? 0) * 60),
        otherLocation: other?.location ?? "CENTER",
      };
    }),
    suggestedStartMin:
      found.length > 0 ? suggestStart(candidate, existing, config.spacing) : null,
    blocking: found.length > 0 && config.blockOverlappingBooking,
  };
}
