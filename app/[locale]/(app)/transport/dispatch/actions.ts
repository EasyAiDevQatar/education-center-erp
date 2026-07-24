"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { transportEnabled, distanceKm } from "@/lib/transport/settings";
import { buildDayPlan, buildTripsForPassenger } from "@/lib/transport/trip-data";
import { allocate } from "@/lib/transport/allocate";
import { generatorMayReplace } from "@/lib/transport/trips";
import type { TripStatus } from "@/lib/enums";
import type { Leg } from "@/lib/transport/chain";
import type { Assignment } from "@/lib/transport/allocate";

export type ActionState = { ok?: boolean; error?: string; message?: string };

async function guard() {
  const s = await getSession();
  if (!s || !STAFF_ROLES.includes(s.role)) return null;
  if (!(await transportEnabled())) return null;
  return s;
}

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const keySchema = z.string().regex(/^(TEACHER|STUDENT):.+$/);
const dayStart = (day: string) => new Date(`${day}T00:00:00.000Z`);
const parseKey = (key: string) => {
  const m = /^(TEACHER|STUDENT):(.+)$/.exec(key);
  return m ? { kind: m[1] as "TEACHER" | "STUDENT", id: m[2] } : null;
};
const worstOf = (a: string, b: string) =>
  a === "INVALID" || b === "INVALID" ? "INVALID" : a === "WARNING" || b === "WARNING" ? "WARNING" : "VALID";

/**
 * Allocate one passenger's legs to ONE driver; returns the ordered items.
 * `assignedCount` mirrors the generator's leniency: a trip is buildable as long
 * as at least one leg placed (the rest fall back to their session windows and
 * are then flagged by validation) — refusing only when nothing fits at all.
 */
function allocateOne(
  plan: Awaited<ReturnType<typeof buildDayPlan>>,
  pLegs: Leg[],
  driverId: string,
): { items: { leg: Leg; a: Assignment | null }[]; assignedCount: number; score: number | null } {
  const ad = plan.allocDrivers.find((d) => d.id === driverId);
  if (!ad) return { items: [], assignedCount: 0, score: null };
  const { assignments } = allocate(
    pLegs.map((l) => ({ id: l.id, from: l.from, to: l.to, readyMin: l.readyMin, dueMin: l.dueMin, passengers: 1 })),
    [ad],
    plan.config.profile,
    { distanceKm, maxDeadheadKm: plan.config.maxDeadheadKm },
  );
  const asg = new Map(assignments.map((a) => [a.legId, a]));
  const items = pLegs
    .map((leg) => ({ leg, a: asg.get(leg.id) ?? null }))
    .sort((x, y) => x.leg.readyMin - y.leg.readyMin || x.leg.id.localeCompare(y.leg.id));
  return { items, assignedCount: items.filter((x) => x.a).length, score: assignments[0]?.score ?? null };
}

export type PreviewAll =
  | { ok: true; drivers: { driverId: string; status: string; feasible: boolean }[] }
  | { ok: false; error: string };

/**
 * Score assigning a pool passenger to EVERY driver in one plan build — powers the
 * best-lane halo the moment a card is picked up. No writes.
 */
export async function previewAssignAll(locale: string, day: string, passengerKey: string): Promise<PreviewAll> {
  const s = await guard();
  if (!s) return { ok: false, error: "forbidden" };
  if (!daySchema.safeParse(day).success || !keySchema.safeParse(passengerKey).success) return { ok: false, error: "invalid" };
  const pk = parseKey(passengerKey);
  if (!pk) return { ok: false, error: "invalid" };

  const plan = await buildDayPlan(locale, day);
  const pLegs = plan.legs.filter((l) => l.passengerKind === pk.kind && l.passengerId === pk.id);
  if (pLegs.length === 0) return { ok: false, error: "noLegs" };
  const start = dayStart(day);

  const drivers: { driverId: string; status: string; feasible: boolean }[] = [];
  for (const ad of plan.allocDrivers) {
    const { items, assignedCount, score } = allocateOne(plan, pLegs, ad.id);
    if (assignedCount === 0) {
      drivers.push({ driverId: ad.id, status: "INVALID", feasible: false });
      continue;
    }
    const driver = plan.drivers.find((d) => d.id === ad.id) ?? null;
    const built = await buildTripsForPassenger({
      plan, start, baseLegKey: `day:${passengerKey}`, pkind: pk.kind, passengerId: pk.id,
      items, driverId: ad.id, driver, autoAllocated: false, allocationScore: score, persist: false,
    });
    const status = built.reduce((acc, b) => worstOf(acc, b.validationStatus), "VALID");
    drivers.push({ driverId: ad.id, status, feasible: true });
  }
  return { ok: true, drivers };
}

/** Commit: build the passenger's trips on the chosen driver (manual edit). */
export async function assignToDriver(locale: string, day: string, passengerKey: string, driverId: string): Promise<ActionState> {
  const s = await guard();
  if (!s) return { error: "forbidden" };
  if (!daySchema.safeParse(day).success || !keySchema.safeParse(passengerKey).success) return { error: "invalid" };
  const pk = parseKey(passengerKey);
  if (!pk) return { error: "invalid" };

  const plan = await buildDayPlan(locale, day);
  const pLegs = plan.legs.filter((l) => l.passengerKind === pk.kind && l.passengerId === pk.id);
  if (pLegs.length === 0) return { error: "noLegs" };
  const { items, assignedCount, score } = allocateOne(plan, pLegs, driverId);
  if (assignedCount === 0) return { error: "infeasible" };

  const start = dayStart(day);
  const baseLegKey = `day:${passengerKey}`;
  // Replace this passenger's own generator/manual trips; never a human-approved one.
  const prior = await db.trip.findMany({ where: { date: start, linkGroup: baseLegKey }, select: { id: true, status: true } });
  const removable = prior.filter((t) => generatorMayReplace(t.status as TripStatus));
  if (removable.length < prior.length) return { error: "locked" };
  if (removable.length) {
    const ids = removable.map((t) => t.id);
    await db.tripStop.deleteMany({ where: { tripId: { in: ids } } });
    await db.trip.deleteMany({ where: { id: { in: ids } } });
  }

  const driver = plan.drivers.find((d) => d.id === driverId) ?? null;
  const built = await buildTripsForPassenger({
    plan, start, baseLegKey, pkind: pk.kind, passengerId: pk.id, items, driverId, driver,
    autoAllocated: false, allocationScore: score, byUserId: s.userId ?? null, manualEdit: true, persist: true,
  });
  await writeAudit("Trip", `assign-${passengerKey}-${day}`, "CREATE", { after: { driverId, trips: built.length } });
  revalidatePath(`/${locale}/transport/dispatch`);
  revalidatePath(`/${locale}/transport/planner`);
  return { ok: true, message: String(built.length) };
}

/** Send a passenger back to the pool (delete their replaceable trips). */
export async function unassignPassenger(locale: string, day: string, passengerKey: string): Promise<ActionState> {
  const s = await guard();
  if (!s) return { error: "forbidden" };
  if (!daySchema.safeParse(day).success || !keySchema.safeParse(passengerKey).success) return { error: "invalid" };

  const start = dayStart(day);
  const baseLegKey = `day:${passengerKey}`;
  const prior = await db.trip.findMany({ where: { date: start, linkGroup: baseLegKey }, select: { id: true, status: true } });
  const removable = prior.filter((t) => generatorMayReplace(t.status as TripStatus));
  if (removable.length === 0) return { error: prior.length ? "locked" : "notfound" };
  const ids = removable.map((t) => t.id);
  await db.tripStop.deleteMany({ where: { tripId: { in: ids } } });
  await db.trip.deleteMany({ where: { id: { in: ids } } });
  await writeAudit("Trip", `unassign-${passengerKey}-${day}`, "DELETE", { after: { removed: ids.length } });
  revalidatePath(`/${locale}/transport/dispatch`);
  revalidatePath(`/${locale}/transport/planner`);
  return { ok: true, message: String(ids.length) };
}
