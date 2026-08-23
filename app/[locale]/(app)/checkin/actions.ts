"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { resolvePricePerHour } from "@/lib/pricing";
import { notifySession } from "@/lib/integrations/notify";
import { revertPackageHours, syncSessionPaymentStatus } from "@/lib/billing";
import { applyMark, MARKS, markCheckedIn, markCheckedOut } from "@/lib/attendance";
import { uniqueCode, isShortCode } from "@/lib/checkin-code";
import { distanceMeters, GEOFENCE_RADIUS_M } from "@/lib/geo";
import { CHECKIN_METHODS } from "@/lib/enums";
import { canCheckIn, canCheckOut, canUndoAttendance } from "@/lib/session-lifecycle";
import { centerNowTime, centerWallClockNow, combineDateTime } from "@/lib/session-time";

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
  if (!canCheckIn(session.status)) return { error: "invalidState" };

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

  await markCheckedIn(id, method);
  // The geofence reading belongs to this path only — it is how the kiosk knows
  // the phone was at the student's home, and no other caller has one.
  await db.session.update({
    where: { id },
    data: { checkInLat: lat ?? null, checkInLng: lng ?? null },
  });
  await writeAudit("Session", id, "UPDATE", { after: { status: "CHECKED_IN", method } });
  revalidate(locale);
  return { ok: true, distance };
}

/** Check out — marks the session completed and records the measured duration. */
export async function checkOutSession(locale: string, id: string): Promise<CheckinResult> {
  if (await guard()) return { error: "forbidden" };
  const session = await db.session.findUnique({ where: { id } });
  if (!session) return { error: "notfound" };
  if (session.status !== "CHECKED_IN" || !session.studentCheckInAt) {
    return { error: "invalidState" };
  }
  if (!canCheckOut(session.status, session.studentCheckInAt)) return { error: "tooSoon" };

  if (!(await markCheckedOut(id))) return { error: "invalidState" };
  await writeAudit("Session", id, "UPDATE", { after: { status: "COMPLETED", via: "checkout" } });
  revalidate(locale);
  return { ok: true };
}

/** Staff-operated check-in from the attendance roster. Unlike the kiosk and
 * home flows this is an authenticated human decision, so it does not ask for
 * the student's PIN or a GPS reading. */
export async function manualCheckInSession(
  locale: string,
  id: string,
): Promise<CheckinResult> {
  if (await guard()) return { error: "forbidden" };
  const session = await db.session.findUnique({ where: { id }, select: { status: true } });
  if (!session) return { error: "notfound" };
  if (!canCheckIn(session.status)) return { error: "invalidState" };

  if (!(await markCheckedIn(id, "MANUAL"))) return { error: "invalidState" };
  await writeAudit("Session", id, "UPDATE", {
    after: { status: "CHECKED_IN", method: "MANUAL", via: "roster" },
  });
  revalidate(locale);
  return { ok: true };
}

/**
 * Mark a scheduled session as a no-show.
 *
 * The student did not attend, so any package hours it had drawn go back and the
 * payment status is recomputed under the centre's no-show rule. This used to be
 * a bare status write, which left drawn hours consumed and the parent still
 * shown as owing for a lesson nobody gave.
 */
export async function markNoShow(locale: string, id: string): Promise<CheckinResult> {
  if (await guard()) return { error: "forbidden" };
  if (!(await applyMark(id, "NO_SHOW"))) return { error: "invalidState" };
  await writeAudit("Session", id, "UPDATE", { after: { status: "NO_SHOW" } });
  revalidate(locale);
  return { ok: true };
}

/** Revert attendance back to scheduled (undo a mistaken tap). */
export async function undoCheckin(locale: string, id: string): Promise<CheckinResult> {
  if (await guard()) return { error: "forbidden" };
  const session = await db.session.findUnique({ where: { id }, select: { status: true } });
  if (!session) return { error: "notfound" };
  if (!canUndoAttendance(session.status)) return { error: "invalidState" };

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

export type AttendanceState = {
  ok?: boolean;
  error?: string;
  count?: number;
  /** Set by the QR lookup so the kiosk can confirm who was just marked. */
  studentName?: string;
};


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
      ...(d.teacherId === null
        ? { teacherId: null }
        : d.teacherId
          ? { teacherId: d.teacherId }
          : {}),
    },
    select: { id: true, date: true, hours: true },
  });

  let count = 0;
  const now = centerWallClockNow();
  for (const target of targets) {
    // "All present" finalises teaching and money, so it cannot reach forward
    // into a lesson that has not ended yet.
    if (
      d.mark === "COMPLETED" &&
      target.date.getTime() + Number(target.hours) * 3_600_000 > now.getTime()
    ) {
      continue;
    }
    if (await applyMark(target.id, d.mark)) count++;
  }

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
  /** Set on the second call once the operator has picked which session. */
  sessionId: z.string().optional().nullable(),
});

export type ScanChoice = {
  id: string;
  startMin: number;
  teacherName: string | null;
  status: string;
};

export type ScanOutcome = AttendanceState & {
  /** True when this scan was the second one — the student has just left. */
  checkedOut?: boolean;
  /** Present when the operator must choose which session to credit. */
  choices?: ScanChoice[];
  /** Echoed back so the picker can re-submit without re-scanning. */
  token?: string;
  /** True when a walk-in session was created rather than matched. */
  walkIn?: boolean;
};

/**
 * Scan a student's card and record their attendance.
 *
 * Three behaviours the centre controls from Settings:
 *  - `attendancePickSession` — show every session for the day and let the
 *    operator choose, instead of silently taking the nearest one.
 *  - `attendanceWalkIn` — what to do when the student has no session today:
 *    FLAG (create one with no teacher, for the admin to assign), ASSIGN (use
 *    their assigned teacher), ASK (refuse and let the operator book), or NONE.
 */
/**
 * One scan, one step forward.
 *
 * Scanning used to jump straight to COMPLETED, so a card was a way of saying
 * "this lesson happened" rather than "this child is here" — and there was no
 * way at all to record when they left. The first scan checks in, the second
 * checks out, which is what a card at a door is for and what makes the
 * recorded duration mean anything.
 *
 * Returns true when this scan was the check-out, so the kiosk can say which
 * of the two just happened.
 */
async function scanStep(
  sessionId: string,
  status: string,
): Promise<"checkedIn" | "checkedOut" | "tooSoon" | "invalidState"> {
  if (status === "CHECKED_IN") {
    const row = await db.session.findUnique({
      where: { id: sessionId },
      select: { studentCheckInAt: true },
    });
    if (!row?.studentCheckInAt) return "invalidState";
    if (!canCheckOut(status, row.studentCheckInAt)) return "tooSoon";
    return (await markCheckedOut(sessionId)) ? "checkedOut" : "invalidState";
  }
  if (!canCheckIn(status)) return "invalidState";
  return (await markCheckedIn(sessionId, "QR")) ? "checkedIn" : "invalidState";
}

export async function checkInByQr(
  locale: string,
  input: z.infer<typeof qrSchema>,
): Promise<ScanOutcome> {
  if (await guard()) return { error: "forbidden" };
  const parsed = qrSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const { token, date, sessionId } = parsed.data;

  const student = await db.student.findUnique({ where: { qrToken: token } });
  if (!student) return { error: "unknownCard" };

  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  // Second pass: the operator already chose. Verify it belongs to this student
  // so a stale id from another card can't be credited here.
  if (sessionId) {
    const chosen = await db.session.findFirst({
      where: {
        id: sessionId,
        studentId: student.id,
        date: { gte: start, lt: end },
        status: { in: ["SCHEDULED", "CHECKED_IN"] },
      },
    });
    if (!chosen) return { error: "invalid", studentName: student.name };
    const step = await scanStep(chosen.id, chosen.status);
    if (step === "tooSoon" || step === "invalidState") {
      return { error: step, studentName: student.name };
    }
    revalidate(locale);
    return { ok: true, studentName: student.name, checkedOut: step === "checkedOut" };
  }

  const settingsRows = await db.setting.findMany({
    where: { key: { in: ["attendancePickSession", "attendanceWalkIn"] } },
  });
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  const pickSession = settings.attendancePickSession === "true";
  const walkIn = settings.attendanceWalkIn ?? "FLAG";

  const todays = await db.session.findMany({
    where: {
      studentId: student.id,
      date: { gte: start, lt: end },
      status: { in: ["SCHEDULED", "CHECKED_IN"] },
    },
    include: { teacher: true },
    orderBy: { date: "asc" },
  });

  const minOf = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

  /* ---- nothing booked today ---- */
  if (todays.length === 0) {
    if (walkIn === "NONE") return { error: "noSessionToday", studentName: student.name };
    if (walkIn === "ASK") return { error: "noSessionAsk", studentName: student.name };

    if (!student.gradeLevelId) {
      // No grade means no price, and an unpriced session would quietly under-bill.
      return { error: "noGradeLevel", studentName: student.name };
    }

    // ASSIGN uses the student's teacher for the current year, if there is
    // exactly one obvious choice; otherwise fall back to leaving it unassigned
    // rather than crediting someone's payroll arbitrarily.
    let teacherId: string | null = null;
    if (walkIn === "ASSIGN") {
      const assigned = await db.studentTeacher.findMany({
        where: { studentId: student.id },
        orderBy: { createdAt: "asc" },
        take: 2,
      });
      if (assigned.length === 1) teacherId = assigned[0].teacherId;
    }

    const when = combineDateTime(date, centerNowTime());
    const pricePerHour = await resolvePricePerHour(student.gradeLevelId, "CENTER", when);

    const created = await db.session.create({
      data: {
        date: when,
        studentId: student.id,
        teacherId,
        gradeLevelId: student.gradeLevelId,
        location: "CENTER",
        hours: 1,
        pricePerHour,
        total: pricePerHour,
        paymentStatus: "UNPAID",
        status: "CHECKED_IN",
        checkInMethod: "QR",
        studentCheckInAt: new Date(),
        // Unassigned walk-ins surface in the "needs a teacher" list until an
        // admin allocates one — nobody's payroll moves before then.
        needsTeacher: teacherId === null,
      },
    });
    await writeAudit("Session", created.id, "CREATE", {
      after: { via: "qr-walkin", studentId: student.id, teacherId },
    });
    // A walk-in writes its session straight to COMPLETED rather than going
    // through applyMark, so it has to say so itself. The family cannot tell a
    // walk-in from a booked lesson, and should not have to.
    await notifySession("CHECKED_IN", created.id);
    revalidate(locale);
    return { ok: true, studentName: student.name, walkIn: true };
  }

  /* ---- one or more booked ---- */
  if (pickSession && todays.length > 1) {
    return {
      studentName: student.name,
      token,
      choices: todays.map((s) => ({
        id: s.id,
        startMin: minOf(s.date),
        teacherName: s.teacher?.name ?? null,
        status: s.status,
      })),
    };
  }

  const [nowHour, nowMinute] = centerNowTime().split(":").map(Number);
  const nowMin = nowHour * 60 + nowMinute;
  const closest = todays.reduce((best, s) =>
    Math.abs(minOf(s.date) - nowMin) < Math.abs(minOf(best.date) - nowMin) ? s : best,
  );

  const step = await scanStep(closest.id, closest.status);
  if (step === "tooSoon" || step === "invalidState") {
    return { error: step, studentName: student.name };
  }

  await writeAudit("Session", closest.id, "UPDATE", {
    after: { via: "qr", step, studentId: student.id },
  });
  revalidate(locale);
  return { ok: true, studentName: student.name, checkedOut: step === "checkedOut" };
}

/** Mint QR tokens for active students that don't have one yet. */
export async function ensureQrTokens(locale: string): Promise<AttendanceState> {
  if (await guard()) return { error: "forbidden" };
  // Students with no code, and students still holding one of the old
  // twelve-character tokens — those cannot be read off a card or said down a
  // phone, which is the whole point of the change.
  const candidates = await db.student.findMany({
    where: { active: true },
    select: { id: true, qrToken: true },
  });
  let count = 0;
  for (const s of candidates) {
    if (isShortCode(s.qrToken)) continue;
    await db.student.update({ where: { id: s.id }, data: { qrToken: await uniqueCode() } });
    count++;
  }
  revalidatePath(`/${locale}/checkin/cards`);
  return { ok: true, count };
}

/**
 * Give one student a new code.
 *
 * A card that has been lost is a card somebody else can present, and the only
 * way to retire it is to issue another. Kept separate from ensureQrTokens so
 * that reissuing for one child never sweeps the whole school.
 */
export async function regenerateQrToken(locale: string, studentId: string): Promise<AttendanceState> {
  if (await guard()) return { error: "forbidden" };
  const student = await db.student.findUnique({ where: { id: studentId }, select: { id: true } });
  if (!student) return { error: "notfound" };
  await db.student.update({ where: { id: studentId }, data: { qrToken: await uniqueCode() } });
  await writeAudit("Student", studentId, "UPDATE", { after: { qrToken: "reissued" } });
  revalidatePath(`/${locale}/checkin/cards`);
  return { ok: true, count: 1 };
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

  await db.session.update({ where: { id: sessionId }, data: { autoCompleted: false } });
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
  const pending = await db.session.findFirst({
    where: { id: sessionId, autoCompleted: true, status: "SCHEDULED" },
    select: { id: true },
  });
  if (!pending) return { error: "notAuto" };
  if (!(await applyMark(sessionId, "COMPLETED", true))) return { error: "invalidState" };
  await db.session.update({ where: { id: sessionId }, data: { autoCompleted: false } });
  revalidate(locale);
  return { ok: true };
}

/** Accept every pending auto-completion at once. */
export async function confirmAllAutoComplete(locale: string): Promise<AttendanceState> {
  if (await guard()) return { error: "forbidden" };
  const pending = await db.session.findMany({
    where: { autoCompleted: true, status: "SCHEDULED" },
    select: { id: true },
  });
  let count = 0;
  for (const row of pending) {
    if (!(await applyMark(row.id, "COMPLETED", true))) continue;
    await db.session.update({ where: { id: row.id }, data: { autoCompleted: false } });
    count++;
  }
  await writeAudit("Session", "bulk-confirm-auto", "UPDATE", { after: { count } });
  revalidate(locale);
  return { ok: true, count };
}
