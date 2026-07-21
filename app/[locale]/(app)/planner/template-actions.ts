"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { resolvePricePerHour } from "@/lib/pricing";
import { combineDateTime } from "@/lib/session-time";
import { toNumber } from "@/lib/money";
import { minToHHMM } from "@/lib/planner";
import { weekdayOf } from "@/lib/conflicts";
import { LOCATIONS, type LocationType } from "@/lib/enums";

export type TemplateState = {
  ok?: boolean;
  error?: string;
  /** Drafts created. */
  count?: number;
  /** Rows skipped because an identical session already existed that day. */
  skipped?: number;
};

async function guard() {
  const s = await getSession();
  return !s || !STAFF_ROLES.includes(s.role);
}

function revalidate(locale: string) {
  revalidatePath(`/${locale}/planner`);
  revalidatePath(`/${locale}/calendar`);
  revalidatePath(`/${locale}/sessions`);
}

function dayRange(date: string) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { gte: start, lt: end };
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ---------------- template CRUD ---------------- */

const saveSchema = z.object({
  id: z.string().optional().nullable(),
  teacherId: z.string().min(1),
  studentId: z.string().min(1),
  weekday: z.coerce.number().int().min(0).max(6),
  startMin: z.coerce.number().int().min(0).max(24 * 60),
  hours: z.coerce.number().min(0.25).max(12),
  location: z.enum(LOCATIONS),
});

export async function saveTemplate(
  locale: string,
  input: z.infer<typeof saveSchema>,
): Promise<TemplateState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const { id, ...data } = parsed.data;

  if (id) {
    await db.plannerTemplate.update({ where: { id }, data });
  } else {
    await db.plannerTemplate.create({ data });
  }
  await writeAudit("PlannerTemplate", id ?? "new", id ? "UPDATE" : "CREATE", { after: data });
  revalidate(locale);
  return { ok: true };
}

export async function deleteTemplate(locale: string, id: string): Promise<TemplateState> {
  if (await guard()) return { error: "forbidden" };
  await db.plannerTemplate.delete({ where: { id } });
  await writeAudit("PlannerTemplate", id, "DELETE", {});
  revalidate(locale);
  return { ok: true };
}

/* ---------------- generation ---------------- */

/**
 * Create DRAFT sessions from a set of (teacher, student, start, hours,
 * location) rows on `date`, skipping any that already exist that day.
 *
 * Shared by "generate from template" and "copy last week" so both get the same
 * de-duplication and pricing behaviour — running either twice is a no-op rather
 * than a duplicated day.
 */
async function materialiseDrafts(
  date: string,
  rows: {
    teacherId: string;
    studentId: string;
    startMin: number;
    hours: number;
    location: LocationType;
  }[],
): Promise<{ count: number; skipped: number }> {
  if (rows.length === 0) return { count: 0, skipped: 0 };

  const existing = await db.session.findMany({
    where: { date: dayRange(date) },
    select: { teacherId: true, studentId: true, date: true },
  });
  const taken = new Set(
    existing.map(
      (e) =>
        `${e.teacherId}|${e.studentId}|${e.date.getUTCHours() * 60 + e.date.getUTCMinutes()}`,
    ),
  );

  // Grade level comes from the student record; rows without one can't be priced.
  const students = await db.student.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.studentId))] } },
    select: { id: true, gradeLevelId: true },
  });
  const gradeOf = new Map(students.map((s) => [s.id, s.gradeLevelId]));

  let count = 0;
  let skipped = 0;

  for (const r of rows) {
    const key = `${r.teacherId}|${r.studentId}|${r.startMin}`;
    if (taken.has(key)) {
      skipped++;
      continue;
    }
    const gradeLevelId = gradeOf.get(r.studentId);
    if (!gradeLevelId) {
      skipped++;
      continue;
    }

    const when = combineDateTime(date, minToHHMM(r.startMin));
    const pricePerHour = await resolvePricePerHour(gradeLevelId, r.location, when);
    await db.session.create({
      data: {
        date: when,
        studentId: r.studentId,
        teacherId: r.teacherId,
        gradeLevelId,
        location: r.location,
        hours: r.hours,
        pricePerHour,
        total: pricePerHour * r.hours,
        paymentStatus: "UNPAID",
        status: "DRAFT",
      },
    });
    taken.add(key);
    count++;
  }
  return { count, skipped };
}

const generateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Limit to one teacher; omit for the whole centre. */
  teacherId: z.string().optional().nullable(),
});

/** Turn every template matching the day's weekday into a DRAFT session. */
export async function generateDayFromTemplates(
  locale: string,
  input: z.infer<typeof generateSchema>,
): Promise<TemplateState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const templates = await db.plannerTemplate.findMany({
    where: {
      active: true,
      weekday: weekdayOf(d.date),
      ...(d.teacherId ? { teacherId: d.teacherId } : {}),
    },
  });

  const res = await materialiseDrafts(
    d.date,
    templates.map((x) => ({
      teacherId: x.teacherId,
      studentId: x.studentId,
      startMin: x.startMin,
      hours: toNumber(x.hours),
      // `location` is a plain string column; the writers only ever store LOCATIONS.
      location: x.location as LocationType,
    })),
  );

  await writeAudit("Session", "generate-from-template", "CREATE", {
    after: { date: d.date, teacherId: d.teacherId ?? "all", ...res },
  });
  revalidate(locale);
  return { ok: true, ...res };
}

/** Copy the same weekday from seven days earlier into `date` as DRAFTs. */
export async function copyLastWeek(
  locale: string,
  input: z.infer<typeof generateSchema>,
): Promise<TemplateState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const source = await db.session.findMany({
    where: {
      date: dayRange(addDays(d.date, -7)),
      // A cancelled lesson last week is not part of the normal week.
      status: { notIn: ["CANCELLED"] },
      ...(d.teacherId ? { teacherId: d.teacherId } : {}),
    },
  });

  const res = await materialiseDrafts(
    d.date,
    source
      .filter((x): x is typeof x & { teacherId: string } => x.teacherId !== null)
      .map((x) => ({
      teacherId: x.teacherId,
      studentId: x.studentId,
      startMin: x.date.getUTCHours() * 60 + x.date.getUTCMinutes(),
      hours: toNumber(x.hours),
      // `location` is a plain string column; the writers only ever store LOCATIONS.
      location: x.location as LocationType,
    })),
  );

  await writeAudit("Session", "copy-last-week", "CREATE", {
    after: { date: d.date, teacherId: d.teacherId ?? "all", ...res },
  });
  revalidate(locale);
  return { ok: true, ...res };
}

const fromSessionSchema = z.object({ sessionId: z.string().min(1) });

/** Promote an existing session into a recurring weekly template. */
export async function saveSessionAsTemplate(
  locale: string,
  input: z.infer<typeof fromSessionSchema>,
): Promise<TemplateState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = fromSessionSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };

  const s = await db.session.findUnique({ where: { id: parsed.data.sessionId } });
  if (!s) return { error: "notfound" };
  // A recurring template needs a teacher to recur for.
  if (!s.teacherId) return { error: "noTeacher" };

  const startMin = s.date.getUTCHours() * 60 + s.date.getUTCMinutes();
  const weekday = s.date.getUTCDay();

  const dupe = await db.plannerTemplate.findFirst({
    where: { teacherId: s.teacherId, studentId: s.studentId, weekday, startMin },
  });
  if (dupe) return { ok: true, count: 0 };

  await db.plannerTemplate.create({
    data: {
      teacherId: s.teacherId,
      studentId: s.studentId,
      weekday,
      startMin,
      hours: toNumber(s.hours),
      location: s.location,
    },
  });
  revalidate(locale);
  return { ok: true, count: 1 };
}
