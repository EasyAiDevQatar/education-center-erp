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
  const cfg = plan.config;
  const { assignments } = allocate(
    pLegs.map((l) => ({
      id: l.id,
      from: l.from,
      to: l.to,
      readyMin: l.readyMin,
      dueMin: l.dueMin,
      // Dropping this made the allocator aim at "as late as still arrives on
      // time" instead of the preferred collection minute, so a manual assign
      // planned a different journey from the one the generator would.
      preferredMin: l.preferredMin,
      passengers: 1,
    })),
    [ad],
    cfg.profile,
    {
      distanceKm,
      maxDeadheadKm: cfg.maxDeadheadKm,
      // Plan by the rules the validator enforces. buildDayPlan was taught this
      // and this path was not, so a manual assign routinely wrote a trip the
      // validator then marked INVALID — the allocator and the validator
      // disagreeing about the same journey, again.
      turnaroundMin:
        Math.max(cfg.rules.minDriverTurnaroundMin, cfg.rules.minVehicleTurnaroundMin) +
        cfg.rules.postTripCloseoutMin +
        cfg.rules.preTripInspectionMin,
      serviceMin: Math.ceil(cfg.operational.boardingTimeMin + cfg.operational.dropoffTimeMin),
    },
  );
  const asg = new Map(assignments.map((a) => [a.legId, a]));
  const items = pLegs
    .map((leg) => ({ leg, a: asg.get(leg.id) ?? null }))
    .sort((x, y) => x.leg.readyMin - y.leg.readyMin || x.leg.id.localeCompare(y.leg.id));
  return { items, assignedCount: items.filter((x) => x.a).length, score: assignments[0]?.score ?? null };
}

/**
 * Why a driver would be blocked, in the validator's own words.
 *
 * `code` is usually a `ValidationCode`, looked up in `common.validationCode.*`;
 * `NO_ROOM_IN_SHIFT` is ours, for the case the validator never gets to see
 * because the allocator placed nothing at all.
 */
export type DriverReason = { code: string; level: string; text: string };

export type PreviewAll =
  | {
      ok: true;
      drivers: { driverId: string; status: string; feasible: boolean; reasons: DriverReason[] }[];
    }
  | { ok: false; error: string };

/**
 * Score assigning a pool passenger to EVERY driver in one plan build — powers the
 * best-lane halo the moment a card is picked up. No writes.
 */
export async function previewAssignAll(
  locale: string,
  day: string,
  passengerKey: string,
  /**
   * Score just this journey. Without it every driver is judged on "take this
   * person's whole day" — a different question from the one the Assign button
   * asks. See the note over `scored`.
   */
  legId?: string,
): Promise<PreviewAll> {
  const s = await guard();
  if (!s) return { ok: false, error: "forbidden" };
  if (!daySchema.safeParse(day).success || !keySchema.safeParse(passengerKey).success) return { ok: false, error: "invalid" };
  const pk = parseKey(passengerKey);
  if (!pk) return { ok: false, error: "invalid" };

  const plan = await buildDayPlan(locale, day);
  const pLegs = plan.legs.filter((l) => l.passengerKind === pk.kind && l.passengerId === pk.id);
  if (pLegs.length === 0) return { ok: false, error: "noLegs" };

  // Score exactly what will be written. `assignLegToDriver` allocates ONE leg;
  // scoring all of them judged each driver on taking the entire day, and
  // `allocateOne` is deliberately lenient — a leg that does not fit still
  // becomes a trip, falls back to its session window, and is flagged INVALID.
  // `worstOf` then collapsed that to blocked for EVERY driver, including the
  // one already driving the journey cleanly: a correct answer to a question
  // nobody asked.
  const scored = legId ? pLegs.filter((l) => l.id === legId) : pLegs;
  if (scored.length === 0) return { ok: false, error: "noLegs" };
  const start = dayStart(day);

  const drivers: {
    driverId: string;
    status: string;
    feasible: boolean;
    reasons: DriverReason[];
  }[] = [];
  for (const ad of plan.allocDrivers) {
    const { items, assignedCount, score } = allocateOne(plan, scored, ad.id);
    if (assignedCount === 0) {
      // Nothing placed at all: shift, deadhead, or the clock. The validator
      // never runs on a trip that was never built, so say the one true thing
      // rather than showing a bare red badge.
      drivers.push({
        driverId: ad.id,
        status: "INVALID",
        feasible: false,
        reasons: [{ code: "NO_ROOM_IN_SHIFT", level: "INVALID", text: "" }],
      });
      continue;
    }
    const driver = plan.drivers.find((d) => d.id === ad.id) ?? null;
    const built = await buildTripsForPassenger({
      plan, start, baseLegKey: `day:${passengerKey}`, pkind: pk.kind, passengerId: pk.id,
      items, driverId: ad.id, driver, autoAllocated: false, allocationScore: score, persist: false,
    });
    const status = built.reduce((acc, b) => worstOf(acc, b.validationStatus), "VALID");
    // `worstOf` keeps the verdict and drops the evidence. The messages were
    // computed either way; discarding them is what left the badge unanswerable.
    const seen = new Set<string>();
    const reasons: DriverReason[] = [];
    for (const b of built)
      for (const m of b.validationMessages) {
        if (m.level === "VALID" || seen.has(m.code)) continue;
        seen.add(m.code);
        reasons.push({ code: m.code, level: m.level, text: m.text });
      }
    drivers.push({ driverId: ad.id, status, feasible: true, reasons });
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
  revalidatePath(`/${locale}/transport/master`);
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
  revalidatePath(`/${locale}/transport/master`);
  revalidatePath(`/${locale}/transport/planner`);
  return { ok: true, message: String(ids.length) };
}

/* ---------------------------------------------- one direction at a time */

export type LegOption = {
  legId: string;
  fromLabel: string;
  toLabel: string;
  readyMin: number;
  dueMin: number;
  /** True when a ride already covers this direction. */
  served: boolean;
};

/** The journey key a trip and a leg share — destination, not just passenger. */
const destKeyOf = (base: string, toSessionId: string | null) =>
  `${base}|${toSessionId ?? "home"}`;

/**
 * Every journey this passenger needs today, and which already have a ride.
 *
 * A person's day is a chain of separate journeys — out to a lesson, on to the
 * next, home at the end — and each is somebody's driving job. Assigning all of
 * them at once because they belong to the same passenger is how one drop
 * silently produced two trips nobody chose.
 */
export async function legOptionsFor(
  locale: string,
  day: string,
  passengerKey: string,
): Promise<{ ok: true; legs: LegOption[] } | { ok?: false; error: string }> {
  const s = await guard();
  if (!s) return { error: "forbidden" };
  if (!daySchema.safeParse(day).success || !keySchema.safeParse(passengerKey).success)
    return { error: "invalid" };
  const pk = parseKey(passengerKey);
  if (!pk) return { error: "invalid" };

  const plan = await buildDayPlan(locale, day);
  const pLegs = plan.legs.filter((l) => l.passengerKind === pk.kind && l.passengerId === pk.id);
  if (pLegs.length === 0) return { error: "noLegs" };

  const base = `day:${passengerKey}`;
  const existing = await db.trip.findMany({
    where: { date: dayStart(day), linkGroup: base },
    select: { stops: { select: { sessionId: true, seq: true } } },
  });
  const servedKeys = new Set(
    existing.map((t) =>
      destKeyOf(base, [...t.stops].sort((a, b) => b.seq - a.seq)[0]?.sessionId ?? null),
    ),
  );

  return {
    ok: true,
    legs: pLegs
      .map((l) => ({
        legId: l.id,
        fromLabel: l.fromLabel,
        toLabel: l.toLabel,
        readyMin: l.readyMin,
        dueMin: l.dueMin,
        served: servedKeys.has(destKeyOf(base, l.toSessionId)),
      }))
      .sort((a, b) => a.readyMin - b.readyMin),
  };
}

/**
 * Give ONE journey to a driver, leaving the passenger's other journeys alone.
 *
 * The difference from `assignToDriver` is the whole point: that one replaces
 * every trip in the passenger's link group, which is right when you are
 * (re)planning their entire day and wrong when you are answering "who takes
 * her to this one lesson".
 */
export async function assignLegToDriver(
  locale: string,
  day: string,
  passengerKey: string,
  legId: string,
  driverId: string,
): Promise<ActionState> {
  const s = await guard();
  if (!s) return { error: "forbidden" };
  if (!daySchema.safeParse(day).success || !keySchema.safeParse(passengerKey).success)
    return { error: "invalid" };
  const pk = parseKey(passengerKey);
  if (!pk) return { error: "invalid" };

  const plan = await buildDayPlan(locale, day);
  const leg = plan.legs.find(
    (l) => l.id === legId && l.passengerKind === pk.kind && l.passengerId === pk.id,
  );
  if (!leg) return { error: "noLegs" };

  const { items, assignedCount, score } = allocateOne(plan, [leg], driverId);
  if (assignedCount === 0) return { error: "infeasible" };

  const start = dayStart(day);
  const base = `day:${passengerKey}`;
  const target = destKeyOf(base, leg.toSessionId);

  // Replace only the trips serving THIS journey. The other direction is
  // somebody's committed work and is not ours to delete.
  const prior = await db.trip.findMany({
    where: { date: start, linkGroup: base },
    select: { id: true, status: true, stops: { select: { sessionId: true, seq: true } } },
  });
  const mine = prior.filter(
    (t) =>
      destKeyOf(base, [...t.stops].sort((a, b) => b.seq - a.seq)[0]?.sessionId ?? null) === target,
  );
  const removable = mine.filter((t) => generatorMayReplace(t.status as TripStatus));
  if (removable.length < mine.length) return { error: "locked" };
  if (removable.length) {
    const ids = removable.map((t) => t.id);
    await db.tripStop.deleteMany({ where: { tripId: { in: ids } } });
    await db.trip.deleteMany({ where: { id: { in: ids } } });
  }

  const driver = plan.drivers.find((d) => d.id === driverId) ?? null;
  const built = await buildTripsForPassenger({
    plan, start, baseLegKey: base, pkind: pk.kind, passengerId: pk.id, items, driverId, driver,
    autoAllocated: false, allocationScore: score, byUserId: s.userId ?? null, manualEdit: true,
    persist: true,
  });
  await writeAudit("Trip", `assign-leg-${legId}-${day}`, "CREATE", {
    after: { driverId, legId, trips: built.length },
  });
  revalidatePath(`/${locale}/transport/master`);
  revalidatePath(`/${locale}/transport/planner`);
  return { ok: true, message: String(built.length) };
}
