"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { resolvePricePerHour } from "@/lib/pricing";
import { writeAudit } from "@/lib/audit";
import { combineDateTime } from "@/lib/session-time";
import { toNumber } from "@/lib/money";
import { compactTimes, hhmmToMin, minToHHMM } from "@/lib/planner";
import { LOCATIONS } from "@/lib/enums";

export type PlannerState = { ok?: boolean; error?: string; count?: number };

async function guard() {
  const s = await getSession();
  return !s || !STAFF_ROLES.includes(s.role);
}

function revalidate(locale: string) {
  revalidatePath(`/${locale}/planner`);
  revalidatePath(`/${locale}/calendar`);
  revalidatePath(`/${locale}/sessions`);
}

const draftSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  teacherId: z.string().min(1),
  studentId: z.string().min(1),
  gradeLevelId: z.string().min(1),
  location: z.enum(LOCATIONS),
  hours: z.coerce.number().min(0.25).max(12),
});

/** Create a planner DRAFT session (pending confirmation; not billable yet). */
export async function createDraftSession(
  locale: string,
  input: z.infer<typeof draftSchema>,
): Promise<PlannerState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const date = combineDateTime(d.date, d.time);
  const pricePerHour = await resolvePricePerHour(d.gradeLevelId, d.location, date);

  const created = await db.session.create({
    data: {
      date,
      studentId: d.studentId,
      teacherId: d.teacherId,
      gradeLevelId: d.gradeLevelId,
      location: d.location,
      hours: d.hours,
      pricePerHour,
      total: pricePerHour * d.hours,
      paymentStatus: "UNPAID",
      status: "DRAFT",
    },
  });
  await writeAudit("Session", created.id, "CREATE", { after: { status: "DRAFT", planner: true } });
  revalidate(locale);
  return { ok: true };
}

const updateSchema = z.object({
  id: z.string().min(1),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  hours: z.coerce.number().min(0.25).max(12),
  location: z.enum(LOCATIONS),
  /** Optional reassignment to another teacher (drag-and-drop / edit dialog). */
  teacherId: z.string().min(1).optional().nullable(),
});

/** Edit a draft's time/duration/location/teacher; price re-resolved from the matrix. */
export async function updateDraft(
  locale: string,
  input: z.infer<typeof updateSchema>,
): Promise<PlannerState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const existing = await db.session.findUnique({ where: { id: d.id } });
  if (!existing) return { error: "notfound" };
  if (existing.status !== "DRAFT") return { error: "notDraft" };

  const date = combineDateTime(existing.date.toISOString().slice(0, 10), d.time);
  const pricePerHour = await resolvePricePerHour(existing.gradeLevelId, d.location, date);

  await db.session.update({
    where: { id: d.id },
    data: {
      date,
      hours: d.hours,
      location: d.location,
      pricePerHour,
      total: pricePerHour * d.hours,
      ...(d.teacherId ? { teacherId: d.teacherId } : {}),
    },
  });
  await writeAudit("Session", d.id, "UPDATE", {
    after: { time: d.time, hours: d.hours, location: d.location, teacherId: d.teacherId ?? undefined },
  });
  revalidate(locale);
  return { ok: true };
}

/** Confirm one draft → COMPLETED (taught, billable). */
export async function confirmSession(locale: string, id: string): Promise<PlannerState> {
  if (await guard()) return { error: "forbidden" };
  const existing = await db.session.findUnique({ where: { id } });
  if (!existing) return { error: "notfound" };
  if (existing.status !== "DRAFT") return { error: "notDraft" };

  await db.session.update({ where: { id }, data: { status: "COMPLETED" } });
  await writeAudit("Session", id, "UPDATE", { after: { status: "COMPLETED", confirmedFromDraft: true } });
  revalidate(locale);
  return { ok: true };
}

const daySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  teacherId: z.string().optional().nullable(),
});

function dayRange(date: string) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { gte: start, lt: end };
}

/** Bulk-confirm a day's drafts (optionally one teacher's). */
export async function confirmDay(
  locale: string,
  input: z.infer<typeof daySchema>,
): Promise<PlannerState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = daySchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const res = await db.session.updateMany({
    where: {
      status: "DRAFT",
      date: dayRange(d.date),
      ...(d.teacherId ? { teacherId: d.teacherId } : {}),
    },
    data: { status: "COMPLETED" },
  });
  await writeAudit("Session", "bulk-confirm", "UPDATE", {
    after: { date: d.date, teacherId: d.teacherId ?? "all", count: res.count },
  });
  revalidate(locale);
  return { ok: true, count: res.count };
}

const compactSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  teacherId: z.string().min(1),
});

/** Re-chain a teacher's draft times to remove gaps (رصّ الأوقات). */
export async function compactTeacherDay(
  locale: string,
  input: z.infer<typeof compactSchema>,
): Promise<PlannerState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = compactSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const [sessions, settings] = await Promise.all([
    db.session.findMany({
      where: { teacherId: d.teacherId, date: dayRange(d.date) },
      orderBy: { date: "asc" },
    }),
    db.setting.findMany({
      where: { key: { in: ["plannerDayStart", "plannerHomeGapMin"] } },
    }),
  ]);
  const map = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const dayStartMin = hhmmToMin(map.plannerDayStart ?? null);
  const homeGapMin = parseInt(map.plannerHomeGapMin ?? "30", 10) || 0;

  const toMin = (dt: Date) => dt.getUTCHours() * 60 + dt.getUTCMinutes();
  const drafts = sessions
    .filter((s) => s.status === "DRAFT")
    .map((s) => ({
      id: s.id,
      startMin: toMin(s.date),
      hours: toNumber(s.hours),
      location: s.location,
    }));
  if (drafts.length === 0) return { ok: true, count: 0 };

  const fixed = sessions
    .filter((s) => s.status !== "DRAFT")
    .map((s) => ({ startMin: toMin(s.date), hours: toNumber(s.hours) }));

  // Anchor at the first session of the day (draft or fixed) so a deliberately
  // late start is preserved; fall back to the centre's day-start setting.
  const firstStart = Math.min(...[...drafts, ...fixed].map((s) => s.startMin));
  const result = compactTimes({
    drafts,
    fixed,
    anchorMin: Number.isFinite(firstStart) ? firstStart : dayStartMin,
    homeGapMin,
  });

  await db.$transaction(
    result.map((r) =>
      db.session.update({
        where: { id: r.id },
        data: { date: combineDateTime(d.date, minToHHMM(r.startMin)) },
      }),
    ),
  );
  await writeAudit("Session", "compact", "UPDATE", {
    after: { date: d.date, teacherId: d.teacherId, count: result.length },
  });
  revalidate(locale);
  return { ok: true, count: result.length };
}

const settingsSchema = z.object({
  dayStart: z.string().regex(/^\d{2}:\d{2}$/),
  homeGapMin: z.coerce.number().min(0).max(180),
});

/** Persist planner defaults (day start, home-visit travel gap). */
export async function savePlannerSettings(
  locale: string,
  input: z.infer<typeof settingsSchema>,
): Promise<PlannerState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  for (const [key, value] of [
    ["plannerDayStart", d.dayStart],
    ["plannerHomeGapMin", String(d.homeGapMin)],
  ] as const) {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
  revalidate(locale);
  return { ok: true };
}
