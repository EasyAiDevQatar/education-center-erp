"use server";

import { z } from "zod";
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
