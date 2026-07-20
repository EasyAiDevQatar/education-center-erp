"use server";

import { z } from "zod";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { notifySession } from "@/lib/integrations/notify";
import { applyPackageHours, revertPackageHours, syncSessionPaymentStatus } from "@/lib/billing";
import { distanceMeters, GEOFENCE_RADIUS_M } from "@/lib/geo";
import { CHECKIN_METHODS } from "@/lib/enums";

export type CheckinResult = { ok?: boolean; error?: string; distance?: number };

async function guard() {
  const s = await getSession();
  return !s || !STAFF_ROLES.includes(s.role);
}

function revalidate(locale: string) {
  revalidatePath(`/${locale}/checkin`);
  revalidatePath(`/${locale}/calendar`);
  revalidatePath(`/${locale}/sessions`);
}

const checkInSchema = z.object({
  id: z.string().min(1),
  method: z.enum(CHECKIN_METHODS),
  lat: z.coerce.number().optional().nullable(),
  lng: z.coerce.number().optional().nullable(),
  pin: z.string().optional().nullable(),
});

/** Check a student in. For GPS (home) check-ins, the server re-verifies the
 *  distance to the student's saved home and the PIN — never trusting the client. */
export async function checkInSession(
  locale: string,
  input: z.infer<typeof checkInSchema>,
): Promise<CheckinResult> {
  if (await guard()) return { error: "forbidden" };
  const parsed = checkInSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const { id, method, lat, lng, pin } = parsed.data;

  const session = await db.session.findUnique({
    where: { id },
    include: { student: true },
  });
  if (!session) return { error: "notfound" };

  let distance: number | undefined;

  if (method === "GPS") {
    const { homeLat, homeLng } = session.student;
    if (homeLat == null || homeLng == null) return { error: "noHome" };
    if (lat == null || lng == null) return { error: "noLocation" };
    distance = distanceMeters(homeLat, homeLng, lat, lng);
    if (distance > GEOFENCE_RADIUS_M) return { error: "tooFar", distance };
  }

  // If the student has a PIN configured, it must match (kiosk & home).
  if (session.student.checkinPin && session.student.checkinPin !== (pin ?? "")) {
    return { error: "pin" };
  }

  const now = new Date();
  await db.session.update({
    where: { id },
    data: {
      status: "CHECKED_IN",
      studentCheckInAt: now,
      teacherCheckInAt: now,
      checkInMethod: method,
      checkInLat: lat ?? null,
      checkInLng: lng ?? null,
    },
  });
  await writeAudit("Session", id, "UPDATE", { after: { status: "CHECKED_IN", method } });
  await notifySession("CHECKED_IN", id);
  revalidate(locale);
  return { ok: true, distance };
}

/** Check out — marks the session completed and records the measured duration. */
export async function checkOutSession(locale: string, id: string): Promise<CheckinResult> {
  if (await guard()) return { error: "forbidden" };
  const session = await db.session.findUnique({ where: { id } });
  if (!session) return { error: "notfound" };

  const now = new Date();
  let actualHours: number | null = null;
  if (session.studentCheckInAt) {
    const ms = now.getTime() - session.studentCheckInAt.getTime();
    actualHours = Math.max(0.25, Math.round((ms / 3_600_000) * 4) / 4); // snap to 15 min
  }
  await db.$transaction(async (tx) => {
    await tx.session.update({
      where: { id },
      data: { status: "COMPLETED", studentCheckOutAt: now, actualHours },
    });
    // Checking out makes it billable — draw down the package once.
    await applyPackageHours(tx, id);
    await syncSessionPaymentStatus(tx, id);
  });
  await writeAudit("Session", id, "UPDATE", { after: { status: "COMPLETED", actualHours } });
  await notifySession("CHECKED_OUT", id);
  revalidate(locale);
  return { ok: true };
}

/** Mark a scheduled session as a no-show. */
export async function markNoShow(locale: string, id: string): Promise<CheckinResult> {
  if (await guard()) return { error: "forbidden" };
  await db.session.update({ where: { id }, data: { status: "NO_SHOW" } });
  await writeAudit("Session", id, "UPDATE", { after: { status: "NO_SHOW" } });
  revalidate(locale);
  return { ok: true };
}

/** Revert attendance back to scheduled (undo a mistaken tap). */
export async function undoCheckin(locale: string, id: string): Promise<CheckinResult> {
  if (await guard()) return { error: "forbidden" };
  await db.$transaction(async (tx) => {
    // No longer taught → give the package hours back.
    await revertPackageHours(tx, id);
    await tx.session.update({
      where: { id },
      data: {
        status: "SCHEDULED",
        studentCheckInAt: null,
        studentCheckOutAt: null,
        teacherCheckInAt: null,
        checkInMethod: null,
        checkInLat: null,
        checkInLng: null,
        actualHours: null,
      },
    });
    await syncSessionPaymentStatus(tx, id);
  });
  await writeAudit("Session", id, "UPDATE", { after: { status: "SCHEDULED" } });
  revalidate(locale);
  return { ok: true };
}

/* ========================= roster board (fast path) ========================= */

/** Statuses the roster board can move a session to. */
const MARKS = ["COMPLETED", "NO_SHOW", "SCHEDULED"] as const;
export type Mark = (typeof MARKS)[number];

export type AttendanceState = {
  ok?: boolean;
  error?: string;
  count?: number;
  /** Set by the QR lookup so the kiosk can confirm who was just marked. */
  studentName?: string;
};

/**
 * Apply an attendance mark, keeping billing in step.
 *
 * COMPLETED is the billable state, so it draws down any package and refreshes
 * payment status; moving back out returns those hours. Both happen in one
 * transaction, so a half-applied mark is impossible. Re-marking the same
 * status is a no-op, which makes repeat taps free.
 */
async function applyMark(sessionId: string, mark: Mark, auto = false) {
  const existing = await db.session.findUnique({ where: { id: sessionId } });
  if (!existing) return false;
  if (existing.status === mark) return true;

  await db.$transaction(async (tx) => {
    const wasCompleted = existing.status === "COMPLETED";
    const willComplete = mark === "COMPLETED";

    await tx.session.update({
      where: { id: sessionId },
      data: {
        status: mark,
        autoCompleted: willComplete ? auto : false,
        studentCheckInAt:
          willComplete && !existing.studentCheckInAt && !auto
            ? new Date()
            : existing.studentCheckInAt,
      },
    });

    if (willComplete && !wasCompleted) await applyPackageHours(tx, sessionId);
    else if (!willComplete && wasCompleted) await revertPackageHours(tx, sessionId);
    await syncSessionPaymentStatus(tx, sessionId);
  });
  return true;
}

const markSchema = z.object({
  sessionId: z.string().min(1),
  mark: z.enum(MARKS),
});

/** One tap on a student card. */
export async function markAttendance(
  locale: string,
  input: z.infer<typeof markSchema>,
): Promise<AttendanceState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = markSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  if (!(await applyMark(parsed.data.sessionId, parsed.data.mark))) return { error: "notfound" };

  await writeAudit("Session", parsed.data.sessionId, "UPDATE", {
    after: { status: parsed.data.mark, via: "roster" },
  });
  revalidate(locale);
  return { ok: true };
}

const bulkSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mark: z.enum(MARKS),
  /** Limit to one teacher's row; omit for the whole day. */
  teacherId: z.string().optional().nullable(),
});

/**
 * Everyone was here — the common case, in one tap.
 *
 * Only touches sessions still awaiting a decision, so it can never overwrite an
 * absence someone already recorded by hand. Drafts are excluded: an unconfirmed
 * plan is not an attendance record.
 */
export async function markAll(
  locale: string,
  input: z.infer<typeof bulkSchema>,
): Promise<AttendanceState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const start = new Date(`${d.date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const targets = await db.session.findMany({
    where: {
      date: { gte: start, lt: end },
      status: { in: ["SCHEDULED", "CHECKED_IN"] },
      ...(d.teacherId ? { teacherId: d.teacherId } : {}),
    },
    select: { id: true },
  });

  let count = 0;
  for (const { id } of targets) if (await applyMark(id, d.mark)) count++;

  await writeAudit("Session", "bulk-attendance", "UPDATE", {
    after: { date: d.date, teacherId: d.teacherId ?? "all", mark: d.mark, count },
  });
  revalidate(locale);
  return { ok: true, count };
}

/* ---------------------------- QR self check-in ---------------------------- */

const qrSchema = z.object({
  token: z.string().trim().min(4).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Scan a student's card and mark their session for the day.
 *
 * Picks the session nearest to now rather than the day's first, so a student
 * arriving for their 17:00 lesson isn't recorded against the 09:00 one they
 * already attended.
 */
export async function checkInByQr(
  locale: string,
  input: z.infer<typeof qrSchema>,
): Promise<AttendanceState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = qrSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };

  const student = await db.student.findUnique({ where: { qrToken: parsed.data.token } });
  if (!student) return { error: "unknownCard" };

  const start = new Date(`${parsed.data.date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const todays = await db.session.findMany({
    where: {
      studentId: student.id,
      date: { gte: start, lt: end },
      status: { in: ["SCHEDULED", "CHECKED_IN"] },
    },
  });
  if (todays.length === 0) return { error: "noSessionToday", studentName: student.name };

  const now = new Date();
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const minOf = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();
  const closest = todays.reduce((best, s) =>
    Math.abs(minOf(s.date) - nowMin) < Math.abs(minOf(best.date) - nowMin) ? s : best,
  );

  await db.session.update({ where: { id: closest.id }, data: { checkInMethod: "QR" } });
  await applyMark(closest.id, "COMPLETED");

  await writeAudit("Session", closest.id, "UPDATE", {
    after: { status: "COMPLETED", via: "qr", studentId: student.id },
  });
  revalidate(locale);
  return { ok: true, studentName: student.name };
}

/** Mint QR tokens for active students that don't have one yet. */
export async function ensureQrTokens(locale: string): Promise<AttendanceState> {
  if (await guard()) return { error: "forbidden" };
  const missing = await db.student.findMany({
    where: { qrToken: null, active: true },
    select: { id: true },
  });
  for (const s of missing) {
    await db.student.update({
      where: { id: s.id },
      data: { qrToken: randomBytes(9).toString("base64url") },
    });
  }
  revalidatePath(`/${locale}/checkin/cards`);
  return { ok: true, count: missing.length };
}

/* ------------------------- auto-complete review list ----------------------- */

/** Undo an auto-completion: back to SCHEDULED, package hours returned. */
export async function undoAutoComplete(
  locale: string,
  sessionId: string,
): Promise<AttendanceState> {
  if (await guard()) return { error: "forbidden" };
  const s = await db.session.findUnique({ where: { id: sessionId } });
  if (!s) return { error: "notfound" };
  if (!s.autoCompleted) return { error: "notAuto" };

  await applyMark(sessionId, "SCHEDULED");
  await writeAudit("Session", sessionId, "UPDATE", {
    after: { status: "SCHEDULED", undoneAutoComplete: true },
  });
  revalidate(locale);
  return { ok: true };
}

/** Accept an auto-completion — clears the flag so it leaves the review list. */
export async function confirmAutoComplete(
  locale: string,
  sessionId: string,
): Promise<AttendanceState> {
  if (await guard()) return { error: "forbidden" };
  await db.session.updateMany({
    where: { id: sessionId, autoCompleted: true },
    data: { autoCompleted: false },
  });
  revalidate(locale);
  return { ok: true };
}

/** Accept every pending auto-completion at once. */
export async function confirmAllAutoComplete(locale: string): Promise<AttendanceState> {
  if (await guard()) return { error: "forbidden" };
  const res = await db.session.updateMany({
    where: { autoCompleted: true },
    data: { autoCompleted: false },
  });
  await writeAudit("Session", "bulk-confirm-auto", "UPDATE", { after: { count: res.count } });
  revalidate(locale);
  return { ok: true, count: res.count };
}
