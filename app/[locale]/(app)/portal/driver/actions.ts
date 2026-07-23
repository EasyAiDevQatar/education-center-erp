"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { transportEnabled } from "@/lib/transport/settings";
import { canTransition } from "@/lib/transport/trips";
import type { TripStatus } from "@/lib/enums";

export type ActionState = { ok?: boolean; error?: string };

/**
 * Resolve the signed-in driver.
 *
 * Ownership comes from the JWT's employeeId → Driver, never from the form: a
 * driver posting someone else's tripId must not be able to start their trip.
 */
async function currentDriver(): Promise<{ driverId: string; userId: string } | null> {
  const s = await getSession();
  if (!s?.employeeId) return null;
  if (!(await transportEnabled())) return null;
  const driver = await db.driver.findUnique({
    where: { employeeId: s.employeeId },
    select: { id: true, active: true },
  });
  if (!driver?.active) return null;
  return { driverId: driver.id, userId: s.userId };
}

/** Load a trip only if it belongs to this driver. */
async function ownedTrip(driverId: string, tripId: string) {
  return db.trip.findFirst({
    where: { id: tripId, driverId },
    select: { id: true, status: true },
  });
}

async function move(
  locale: string,
  tripId: string,
  to: TripStatus,
  extra: Record<string, unknown>,
): Promise<ActionState> {
  const me = await currentDriver();
  if (!me) return { error: "forbidden" };
  const trip = await ownedTrip(me.driverId, tripId);
  if (!trip) return { error: "notfound" };
  const from = trip.status as TripStatus;
  if (!canTransition(from, to)) return { error: "badTransition" };

  await db.$transaction([
    db.trip.update({ where: { id: tripId }, data: { status: to, ...extra } }),
    db.tripEvent.create({
      data: { tripId, fromStatus: from, toStatus: to, byUserId: me.userId },
    }),
  ]);
  await writeAudit("Trip", tripId, "UPDATE", { after: { from, to, by: "driver" } });
  revalidatePath(`/${locale}/portal/driver`);
  return { ok: true };
}

export async function startTrip(locale: string, tripId: string): Promise<ActionState> {
  return move(locale, tripId, "STARTED", { actualStartAt: new Date() });
}

export async function completeTrip(locale: string, tripId: string): Promise<ActionState> {
  return move(locale, tripId, "COMPLETED", { actualEndAt: new Date() });
}

/** Stamp arrival at a stop. Idempotent — a second tap keeps the first time. */
export async function arriveAtStop(locale: string, stopId: string): Promise<ActionState> {
  const me = await currentDriver();
  if (!me) return { error: "forbidden" };
  const stop = await db.tripStop.findFirst({
    where: { id: stopId, trip: { driverId: me.driverId } },
    select: { id: true, arrivedAt: true },
  });
  if (!stop) return { error: "notfound" };
  if (stop.arrivedAt) return { ok: true };

  await db.tripStop.update({ where: { id: stopId }, data: { arrivedAt: new Date() } });
  revalidatePath(`/${locale}/portal/driver`);
  return { ok: true };
}

const pingSchema = z.object({
  tripId: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().int().min(0).max(100000).nullable().optional(),
});

/**
 * Record one location fix.
 *
 * Accepted only while the trip is actually STARTED — a stale browser tab left
 * open overnight cannot keep reporting a driver's position after the run ends.
 * Throttling and accuracy filtering happen client-side in lib/transport/tracking;
 * this is the second line, not the only one.
 */
export async function recordPing(
  input: z.infer<typeof pingSchema>,
): Promise<ActionState> {
  const me = await currentDriver();
  if (!me) return { error: "forbidden" };
  const parsed = pingSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const trip = await db.trip.findFirst({
    where: { id: d.tripId, driverId: me.driverId, status: "STARTED" },
    select: { id: true },
  });
  if (!trip) return { error: "notRunning" };

  await db.driverPing.create({
    data: {
      driverId: me.driverId,
      tripId: trip.id,
      lat: d.lat,
      lng: d.lng,
      accuracyM: d.accuracyM ?? null,
    },
  });
  // Deliberately no revalidatePath: pings arrive every 30s and must not
  // re-render the driver's screen mid-drive.
  return { ok: true };
}
