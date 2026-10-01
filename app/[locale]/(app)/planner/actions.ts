"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { applyMark, applyAttendanceMarkInTransaction } from "@/lib/attendance";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { combineDateTime } from "@/lib/session-time";
import { toNumber } from "@/lib/money";
import { compactTimes, hhmmToMin, minToHHMM } from "@/lib/planner";
import { LOCATIONS } from "@/lib/enums";
import { guardArchived } from "@/lib/academic-year";
import { attendanceBillablePolicy, syncSessionPaymentStatus } from "@/lib/billing";
import { nextReceiptNo } from "@/lib/balances";
import { accountingEnabled, postSource } from "@/lib/accounting/journal-data";
import { linesForPayment } from "@/lib/accounting/posting";
import { notifyPayment, notifySession } from "@/lib/integrations/notify";
import { localToday } from "@/lib/session-time";

export type PlannerState = {
  ok?: boolean;
  error?: string;
  count?: number;
  sessionId?: string;
  paymentId?: string;
  amount?: number;
  /** Confirmed HOME sessions that no trip serves yet — prompts trip planning. */
  homeNeedsTrip?: { count: number; date: string } | null;
};

/** How many of these sessions are HOME lessons no (live) trip serves. */
async function countHomeNeedingTrip(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const home = await db.session.findMany({
    where: { id: { in: ids }, location: "HOME" },
    select: { id: true },
  });
  if (home.length === 0) return 0;
  const served = await db.tripStop.findMany({
    where: {
      sessionId: { in: home.map((x) => x.id) },
      trip: { status: { not: "CANCELLED" } },
    },
    select: { sessionId: true },
  });
  const covered = new Set(served.map((x) => x.sessionId));
  return home.filter((x) => !covered.has(x.id)).length;
}

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
  /** Starts from the price matrix, but the desk may override it for this booking. */
  pricePerHour: z.coerce.number().min(0).max(1_000_000),
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
  const pricePerHour = d.pricePerHour;

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

/** A stable request id makes a retried click return the original booking/receipt. */
export async function createConfirmedPlannerSession(
  locale: string,
  input: z.infer<typeof draftSchema> & {
    requestId: string;
    fastPay: boolean;
    method: "CASH" | "POS" | "QPAY" | "TRANSFER";
  },
): Promise<PlannerState> {
  const viewer = await getSession();
  if (!viewer || !STAFF_ROLES.includes(viewer.role)) return { error: "forbidden" };
  const parsed = draftSchema.extend({
    requestId: z.string().uuid(),
    fastPay: z.boolean(),
    method: z.enum(["CASH", "POS", "QPAY", "TRANSFER"]),
  }).safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;
  const date = combineDateTime(d.date, d.time);
  if (!Number.isFinite(date.getTime())) return { error: "invalid" };
  const paymentDate = combineDateTime(localToday(), "00:00");
  const frozen = await guardArchived(date, ...(d.fastPay ? [paymentDate] : []));
  if (frozen) return { error: frozen };
  const id = `planner-${d.requestId}`;
  const policy = await attendanceBillablePolicy();
  const posting = d.fastPay && await accountingEnabled();
  const receiptNo = d.fastPay ? await nextReceiptNo() : null;
  try {
    const result = await db.$transaction(async (tx) => {
      // Upsert obtains the row lock as well as protecting against concurrent retries.
      const booking = await tx.session.upsert({
        where: { id },
        update: { updatedAt: new Date() },
        create: {
          id, date, studentId: d.studentId, teacherId: d.teacherId,
          gradeLevelId: d.gradeLevelId, location: d.location, hours: d.hours,
          pricePerHour: d.pricePerHour, total: d.pricePerHour * d.hours,
          status: "DRAFT", paymentStatus: "UNPAID", createdById: viewer.userId,
        },
        include: { allocations: { include: { payment: true } } },
      });
      if (booking.createdById !== viewer.userId || booking.studentId !== d.studentId || booking.teacherId !== d.teacherId) {
        throw new Error("invalid");
      }
      if (booking.status === "COMPLETED") {
        const payment = booking.allocations.find((line) => line.payment.status === "COMPLETED")?.payment;
        if (d.fastPay && !payment) throw new Error("invalid");
        return { sessionId: id, paymentId: payment?.id, amount: toNumber(booking.total), fresh: false };
      }
      if (booking.status !== "DRAFT") throw new Error("invalid");
      const [student, teacher, grade] = await Promise.all([
        tx.student.findFirst({ where: { id: d.studentId, active: true } }),
        tx.teacher.findFirst({ where: { id: d.teacherId, active: true } }),
        tx.gradeLevel.findFirst({ where: { id: d.gradeLevelId, active: true } }),
      ]);
      if (!student || !teacher || !grade) throw new Error("invalid");
      if (!await applyAttendanceMarkInTransaction(tx, id, "COMPLETED", policy)) throw new Error("invalid");
      const confirmed = await tx.session.findUniqueOrThrow({ where: { id } });
      const amount = toNumber(confirmed.total);
      let paymentId: string | undefined;
      if (d.fastPay) {
        if (amount <= 0) throw new Error("invalid");
        const payment = await tx.payment.create({ data: {
          date: paymentDate, receiptNo: receiptNo!, studentId: d.studentId,
          teacherId: d.teacherId, amount, method: d.method, createdById: viewer.userId,
          allocations: { create: { sessionId: id, amount } },
        } });
        paymentId = payment.id;
        if (posting) await postSource(tx, {
          date: paymentDate, memo: `Payment — ${receiptNo}`, sourceType: "PAYMENT",
          sourceId: payment.id, lines: linesForPayment({ amount, method: d.method, receiptNo: receiptNo! }),
        });
        await tx.auditLog.create({ data: {
          userId: viewer.userId, entity: "Payment", entityId: payment.id, action: "CREATE",
          after: JSON.stringify({ amount, method: d.method, sessionId: id, planner: true }),
        } });
      }
      await syncSessionPaymentStatus(tx, id);
      await tx.auditLog.create({ data: {
        userId: viewer.userId, entity: "Session", entityId: id, action: "CREATE",
        after: JSON.stringify({ ...d, status: "COMPLETED", planner: true }),
      } });
      return { sessionId: id, paymentId, amount, fresh: true };
    });
    if (result.fresh) {
      // Notification delivery must not turn a committed payment into a failed save.
      await Promise.allSettled([
        notifySession("CHECKED_IN", id),
        ...(result.paymentId ? [notifyPayment(result.paymentId)] : []),
      ]);
    }
    revalidate(locale);
    revalidatePath(`/${locale}/payments`);
    revalidatePath(`/${locale}/students/${d.studentId}`);
    revalidatePath(`/${locale}/teachers/${d.teacherId}`);
    return {
      ok: true, sessionId: result.sessionId, paymentId: result.paymentId, amount: result.amount,
      homeNeedsTrip: d.location === "HOME" ? { count: 1, date: d.date } : null,
    };
  } catch {
    return { error: "invalid" };
  }
}

const updateSchema = z.object({
  id: z.string().min(1),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  hours: z.coerce.number().min(0.25).max(12),
  location: z.enum(LOCATIONS),
  /** Optional reassignment to another teacher (drag-and-drop / edit dialog). */
  teacherId: z.string().min(1).optional().nullable(),
  /** Omitted by drag/move operations, which must preserve the snapshotted rate. */
  pricePerHour: z.coerce.number().min(0).max(1_000_000).optional(),
});

/** Edit a draft while preserving its snapshotted rate unless the desk changes it. */
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
  const pricePerHour = d.pricePerHour ?? toNumber(existing.pricePerHour);

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
    after: {
      time: d.time,
      hours: d.hours,
      location: d.location,
      teacherId: d.teacherId ?? undefined,
      pricePerHour,
    },
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

  // Confirming makes the session billable AND tells the family. It used to do
  // the first half only, with its own copy of the transaction, so a home visit
  // planned here and confirmed reached the parent as silence — the booking
  // form messaged them, the planner did not.
  await applyMark(id, "COMPLETED");
  await writeAudit("Session", id, "UPDATE", { after: { status: "COMPLETED", confirmedFromDraft: true } });
  revalidate(locale);
  const needing = await countHomeNeedingTrip([id]);
  return {
    ok: true,
    homeNeedsTrip: needing
      ? { count: needing, date: existing.date.toISOString().slice(0, 10) }
      : null,
  };
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

  const targets = await db.session.findMany({
    where: {
      status: "DRAFT",
      date: dayRange(d.date),
      ...(d.teacherId ? { teacherId: d.teacherId } : {}),
    },
    select: { id: true },
  });
  const res = { count: 0 };
  for (const { id } of targets) {
    if (await applyMark(id, "COMPLETED")) res.count++;
  }
  await writeAudit("Session", "bulk-confirm", "UPDATE", {
    after: { date: d.date, teacherId: d.teacherId ?? "all", count: res.count },
  });
  revalidate(locale);
  const needing = await countHomeNeedingTrip(targets.map((x) => x.id));
  return {
    ok: true,
    count: res.count,
    homeNeedsTrip: needing ? { count: needing, date: d.date } : null,
  };
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
