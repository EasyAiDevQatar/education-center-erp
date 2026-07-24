"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { transportEnabled } from "@/lib/transport/settings";
import { generateDayTrips, buildDayPlan } from "@/lib/transport/trip-data";
import { loadTransportConfig, distanceKm } from "@/lib/transport/settings";
import { poolCandidates } from "@/lib/transport/pooling";
import { displayName } from "@/lib/names";
import { aiChat } from "@/lib/ai/client";
import { loadAiConfigFor, aiReady } from "@/lib/ai/config";
import { canTransition } from "@/lib/transport/trips";
import { TRIP_STATUSES, type TripStatus } from "@/lib/enums";

export type ActionState = { ok?: boolean; error?: string; message?: string };

async function guard() {
  const s = await getSession();
  if (!s || !STAFF_ROLES.includes(s.role)) return null;
  if (!(await transportEnabled())) return null;
  return s;
}

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Run the engine for a day and write its proposals. Never dispatches. */
export async function generateTrips(
  locale: string,
  day: string,
): Promise<ActionState> {
  const s = await guard();
  if (!s) return { error: "forbidden" };
  if (!daySchema.safeParse(day).success) return { error: "invalid" };

  const res = await generateDayTrips(locale, day, s.userId ?? null);
  await writeAudit("Trip", `generate-${day}`, "CREATE", { after: res });
  revalidatePath(`/${locale}/transport/planner`);
  return {
    ok: true,
    message: `${res.created}/${res.refreshed}/${res.locked}/${res.unassigned}`,
  };
}

/**
 * Move one trip to a new status, writing the history row.
 *
 * The transition is re-checked here against the row's CURRENT status, so a
 * stale board cannot approve a trip that was cancelled in another tab.
 */
export async function setTripStatus(
  locale: string,
  id: string,
  to: TripStatus,
  note?: string,
): Promise<ActionState> {
  const s = await guard();
  if (!s) return { error: "forbidden" };
  if (!TRIP_STATUSES.includes(to)) return { error: "invalid" };

  const trip = await db.trip.findUnique({
    where: { id },
    select: { id: true, status: true, validationStatus: true },
  });
  if (!trip) return { error: "notfound" };
  const from = trip.status as TripStatus;
  if (!canTransition(from, to)) return { error: "badTransition" };

  // Approval gate: an INVALID route can only be approved through the explicit
  // override path (below), never the normal approve button.
  const isApproval = to === "ASSIGNED";
  if (isApproval && trip.validationStatus === "INVALID") {
    return { error: "invalidRoute" };
  }
  const approvalStamp =
    isApproval ? { approvedById: s.userId ?? null, approvedAt: new Date() } : {};

  await db.$transaction([
    db.trip.update({ where: { id }, data: { status: to, ...approvalStamp } }),
    db.tripEvent.create({
      data: { tripId: id, fromStatus: from, toStatus: to, note: note ?? null, byUserId: s.userId ?? null },
    }),
  ]);
  await writeAudit("Trip", id, "UPDATE", { after: { from, to } });
  revalidatePath(`/${locale}/transport/planner`);
  revalidatePath(`/${locale}/transport/trips`);
  return { ok: true };
}

/** Approve every proposal on a day in one click. */
export async function approveAll(locale: string, day: string): Promise<ActionState> {
  const s = await guard();
  if (!s) return { error: "forbidden" };
  if (!daySchema.safeParse(day).success) return { error: "invalid" };

  const start = new Date(`${day}T00:00:00.000Z`);
  const cfg = await loadTransportConfig();
  const proposed = await db.trip.findMany({
    where: { date: start, status: "PROPOSED" },
    select: { id: true, validationStatus: true },
  });

  // One at a time on purpose: a single rejected row must not abort the whole
  // approval (the pattern staff-flow got right and we kept). INVALID routes are
  // skipped — they must go through the explicit override, never a bulk approve.
  let approved = 0;
  let blocked = 0;
  for (const t of proposed) {
    if (t.validationStatus === "INVALID" && !cfg.allowInvalidOverride) {
      blocked++;
      continue;
    }
    try {
      await db.$transaction([
        db.trip.update({
          where: { id: t.id },
          data: { status: "ASSIGNED", approvedById: s.userId ?? null, approvedAt: new Date() },
        }),
        db.tripEvent.create({
          data: { tripId: t.id, fromStatus: "PROPOSED", toStatus: "ASSIGNED", byUserId: s.userId ?? null },
        }),
      ]);
      approved++;
    } catch {
      // Skip and keep going; the board will still show whatever failed.
    }
  }
  await writeAudit("Trip", `approve-all-${day}`, "UPDATE", { after: { approved, blocked } });
  revalidatePath(`/${locale}/transport/planner`);
  return { ok: true, message: String(approved) };
}

/** Hand a trip to a different driver (and their vehicle). */
export async function reassignTrip(
  locale: string,
  id: string,
  driverId: string,
): Promise<ActionState> {
  const s = await guard();
  if (!s) return { error: "forbidden" };
  const driver = await db.driver.findUnique({
    where: { id: driverId },
    select: { id: true, defaultVehicleId: true, active: true },
  });
  if (!driver?.active) return { error: "invalid" };

  await db.trip.update({
    where: { id },
    data: {
      driverId: driver.id,
      vehicleId: driver.defaultVehicleId,
      // A human chose this one; stop calling it an automatic allocation.
      autoAllocated: false,
    },
  });
  await db.tripEvent.create({
    data: { tripId: id, toStatus: "REASSIGNED", note: driverId, byUserId: s.userId ?? null },
  });
  await writeAudit("Trip", id, "UPDATE", { after: { driverId } });
  revalidatePath(`/${locale}/transport/planner`);
  return { ok: true };
}

/** Throw away every untouched proposal for a day. */
export async function clearProposals(locale: string, day: string): Promise<ActionState> {
  const s = await guard();
  if (!s) return { error: "forbidden" };
  if (!daySchema.safeParse(day).success) return { error: "invalid" };
  const start = new Date(`${day}T00:00:00.000Z`);
  const res = await db.trip.deleteMany({ where: { date: start, status: "PROPOSED" } });
  await writeAudit("Trip", `clear-${day}`, "DELETE", { after: { deleted: res.count } });
  revalidatePath(`/${locale}/transport/planner`);
  return { ok: true, message: String(res.count) };
}


/**
 * AI briefing of the day's plan — advisory text only; allocation itself stays
 * deterministic. Feeds the computed plan (assignments, unassigned legs with
 * reasons, passengers skipped for missing pins) to the configured model and
 * returns a short narrative in the user's language.
 */
export async function aiBriefing(locale: string, day: string): Promise<ActionState> {
  const s = await guard();
  if (!s) return { error: "forbidden" };
  if (!daySchema.safeParse(day).success) return { error: "invalid" };
  const cfg = await loadAiConfigFor("briefing");
  if (!aiReady(cfg)) {
    console.error("[aiBriefing] not configured", { enabled: cfg.enabled, hasKey: !!cfg.apiKey, model: cfg.model });
    return { error: "notConfigured" };
  }

  const plan = await buildDayPlan(locale, day);
  const legById = new Map(plan.legs.map((l) => [l.id, l]));
  const summary = {
    date: day,
    drivers: plan.drivers.map((d) => ({ name: d.name, plate: d.plate })),
    assignments: plan.assignments.map((a) => {
      const leg = legById.get(a.legId);
      return {
        passenger: leg?.passengerName,
        from: leg?.fromLabel,
        to: leg?.toLabel,
        driver: plan.drivers.find((d) => d.id === a.driverId)?.name,
        pickupMin: a.pickupMin,
        slackMin: a.slackMin,
        deadheadKm: a.deadheadKm,
      };
    }),
    unassigned: plan.unassigned.map((u) => {
      const leg = legById.get(u.legId);
      return { passenger: leg?.passengerName, from: leg?.fromLabel, to: leg?.toLabel, reason: u.reason };
    }),
    skippedNoCoordinates: plan.skipped.map((x) => x.passengerName),
    centreSet: plan.centreSet,
  };

  const lang = locale === "ar" ? "Arabic" : "English";
  const r = await aiChat(
    [
      {
        role: "system",
        content:
          "You brief the manager of a tutoring centre on the day's transport plan. " +
          "Times are minutes from midnight. Be short and actionable: what is tight " +
          "(low slackMin), who is unassigned and why, and what to fix (e.g. add a home " +
          "pin for skipped passengers, shift a lesson, add a driver). Plain text, a few " +
          `sentences or short bullet lines, in ${lang}.`,
      },
      { role: "user", content: JSON.stringify(summary) },
    ],
    { maxTokens: 3000, timeoutMs: 60_000, config: cfg },
  );
  if (!r.ok) {
    console.error("[aiBriefing] chat failed:", r.error, r.detail?.slice(0, 300));
    return { error: r.error };
  }
  return { ok: true, message: r.text.trim() };
}


/* -------- Manual add-stop + smart ride-pooling --------------------------- */

/** Recompute a trip's distance and time window from its (ordered) stops. */
async function recomputeTrip(tripId: string) {
  const stops = await db.tripStop.findMany({
    where: { tripId },
    orderBy: { seq: "asc" },
    select: { lat: true, lng: true, plannedMin: true },
  });
  if (stops.length === 0) return;
  let km = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    km += distanceKm(
      { lat: stops[i].lat, lng: stops[i].lng },
      { lat: stops[i + 1].lat, lng: stops[i + 1].lng },
    );
  }
  const mins = stops.map((x) => x.plannedMin);
  await db.trip.update({
    where: { id: tripId },
    data: {
      estimatedKm: Math.round(km * 100) / 100,
      plannedStartMin: Math.min(...mins),
      plannedEndMin: Math.max(...mins),
      estimatedMin: Math.max(...mins) - Math.min(...mins),
    },
  });
}

const addStopSchema = z.object({
  tripId: z.string().min(1),
  afterSeq: z.coerce.number().int().min(0),
  kind: z.enum(["PICKUP", "DROPOFF"]),
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  label: z.string().min(1),
  teacherId: z.string().optional().nullable(),
  studentId: z.string().optional().nullable(),
  sessionId: z.string().optional().nullable(),
});

/** Insert a stop into a trip at a position, shifting later stops down. */
export async function addTripStop(
  locale: string,
  input: z.infer<typeof addStopSchema>,
): Promise<ActionState> {
  const s = await guard();
  if (!s) return { error: "forbidden" };
  const parsed = addStopSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const stops = await db.tripStop.findMany({
    where: { tripId: d.tripId },
    orderBy: { seq: "asc" },
    select: { id: true, seq: true, plannedMin: true },
  });
  if (stops.length === 0) return { error: "invalid" };

  // Time the new stop between its neighbours (or just outside the ends).
  const before = stops.filter((x) => x.seq <= d.afterSeq).at(-1) ?? null;
  const after = stops.filter((x) => x.seq > d.afterSeq)[0] ?? null;
  const plannedMin = before && after
    ? Math.round((before.plannedMin + after.plannedMin) / 2)
    : before
      ? before.plannedMin + 15
      : (after?.plannedMin ?? 0) - 15;

  await db.$transaction([
    // Open a gap: everything after the insertion point moves down one seq.
    ...stops
      .filter((x) => x.seq > d.afterSeq)
      .sort((a, b) => b.seq - a.seq) // highest first, no unique-collision
      .map((x) => db.tripStop.update({ where: { id: x.id }, data: { seq: x.seq + 1 } })),
    db.tripStop.create({
      data: {
        tripId: d.tripId,
        seq: d.afterSeq + 1,
        kind: d.kind,
        lat: d.lat,
        lng: d.lng,
        label: d.label,
        plannedMin: Math.max(0, plannedMin),
        passengerTeacherId: d.teacherId || null,
        passengerStudentId: d.studentId || null,
        sessionId: d.sessionId || null,
      },
    }),
  ]);
  await recomputeTrip(d.tripId);
  await writeAudit("Trip", d.tripId, "UPDATE", { after: { addedStop: d.label } });
  revalidatePath(`/${locale}/transport/planner`);
  return { ok: true };
}

/** Remove a stop and re-number the rest 1..n. */
export async function removeTripStop(locale: string, stopId: string): Promise<ActionState> {
  const s = await guard();
  if (!s) return { error: "forbidden" };
  const stop = await db.tripStop.findUnique({ where: { id: stopId }, select: { tripId: true, label: true } });
  if (!stop) return { error: "invalid" };
  await db.tripStop.delete({ where: { id: stopId } });
  const rest = await db.tripStop.findMany({ where: { tripId: stop.tripId }, orderBy: { seq: "asc" }, select: { id: true } });
  await db.$transaction(rest.map((x, i) => db.tripStop.update({ where: { id: x.id }, data: { seq: i + 1 } })));
  await recomputeTrip(stop.tripId);
  await writeAudit("Trip", stop.tripId, "UPDATE", { after: { removedStop: stop.label } });
  revalidatePath(`/${locale}/transport/planner`);
  return { ok: true };
}

export type PoolOption = {
  teacherId: string;
  name: string;
  lat: number;
  lng: number;
  label: string;
  detourKm: number;
  afterSeq: number;
  onTheWay: boolean;
};
export type TripStopRow = { id: string; seq: number; kind: string; label: string; plannedMin: number };
export type PoolingResult = {
  stops: TripStopRow[];
  options: PoolOption[];
};

/**
 * Who could this trip pick up on the way: teachers with a home pin who teach
 * that day and are not already on the trip, ranked by the detour their home
 * adds to the route. Everyone is returned (for a manual add); `onTheWay` flags
 * those inside the centre's detour budget.
 */
export async function tripPoolingOptions(locale: string, tripId: string): Promise<PoolingResult | { error: string }> {
  const sess = await guard();
  if (!sess) return { error: "forbidden" };

  const trip = await db.trip.findUnique({
    where: { id: tripId },
    include: { stops: { orderBy: { seq: "asc" } } },
  });
  if (!trip) return { error: "invalid" };

  const config = await loadTransportConfig();
  const maxDetour = config.maxDeadheadKm; // reuse the empty-km budget as the pool budget
  const route = trip.stops.map((x) => ({ lat: x.lat, lng: x.lng }));
  const already = new Set(trip.stops.map((x) => x.passengerTeacherId).filter(Boolean) as string[]);

  const dayStart = new Date(trip.date);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const teachers = await db.teacher.findMany({
    where: {
      active: true,
      homeLat: { not: null },
      homeLng: { not: null },
      id: { notIn: [...already] },
      sessions: { some: { date: { gte: dayStart, lt: dayEnd } } },
    },
    select: { id: true, name: true, nameEn: true, homeLat: true, homeLng: true, address: true },
  });

  const cands = poolCandidates(
    route,
    teachers.map((tt) => ({ item: tt, point: { lat: tt.homeLat!, lng: tt.homeLng! } })),
    distanceKm,
    Number.POSITIVE_INFINITY, // rank all; flag the near ones
  );

  const options: PoolOption[] = cands.map((c) => ({
    teacherId: c.item.id,
    name: displayName(c.item, locale),
    lat: c.item.homeLat!,
    lng: c.item.homeLng!,
    label: c.item.address ?? displayName(c.item, locale),
    detourKm: c.detourKm,
    afterSeq: c.afterSeq,
    onTheWay: c.detourKm <= maxDetour,
  }));

  return {
    stops: trip.stops.map((x) => ({ id: x.id, seq: x.seq, kind: x.kind, label: x.label, plannedMin: x.plannedMin })),
    options,
  };
}


/* -------- Manual trip creation (build from scratch) --------------------- */

const newTripSchema = z.object({
  day: daySchema,
  driverId: z.string().min(1),
  startMin: z.coerce.number().int().min(0).max(1439),
});

/**
 * Create an empty manual trip for a driver, seeded with the centre as its first
 * stop. The coordinator then builds the route with "Add stop". Status PLANNED
 * (a human-made trip awaiting a driver's dispatch), so the generator never
 * touches it.
 */
export async function createManualTrip(
  locale: string,
  input: z.infer<typeof newTripSchema>,
): Promise<ActionState> {
  const sess = await guard();
  if (!sess) return { error: "forbidden" };
  const parsed = newTripSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const config = await loadTransportConfig();
  if (!config.centre) return { error: "noCentre" };

  const driver = await db.driver.findUnique({
    where: { id: d.driverId },
    select: { defaultVehicleId: true },
  });
  const centreLabel = locale === "ar" ? "المركز" : "Centre";
  const start = new Date(`${d.day}T00:00:00.000Z`);

  await db.trip.create({
    data: {
      date: start,
      status: "PLANNED",
      driverId: d.driverId,
      vehicleId: driver?.defaultVehicleId ?? null,
      plannedStartMin: d.startMin,
      plannedEndMin: d.startMin,
      estimatedKm: 0,
      estimatedMin: 0,
      autoAllocated: false,
      createdById: sess.userId ?? null,
      stops: {
        create: [
          {
            seq: 1,
            kind: "PICKUP",
            lat: config.centre.lat,
            lng: config.centre.lng,
            label: `L1 · ${centreLabel}`,
            plannedMin: d.startMin,
          },
        ],
      },
    },
  });
  await writeAudit("Trip", `manual-${d.day}`, "CREATE", { after: { driverId: d.driverId } });
  revalidatePath(`/${locale}/transport/planner`);
  return { ok: true };
}

/**
 * Approve an INVALID route through an explicit, audited override. Admin-only,
 * a reason is mandatory, and the validation messages are kept — the override
 * records that a human accepted the risk, it does not erase it (spec §22).
 */
export async function overrideApprove(
  locale: string,
  id: string,
  reason: string,
): Promise<ActionState> {
  const s = await guard();
  if (!s) return { error: "forbidden" };
  if (s.role !== "ADMIN") return { error: "forbidden" };
  if (!reason || reason.trim().length < 3) return { error: "reasonRequired" };

  const trip = await db.trip.findUnique({ where: { id }, select: { status: true } });
  if (!trip) return { error: "notfound" };
  if (!canTransition(trip.status as TripStatus, "ASSIGNED")) return { error: "badTransition" };

  await db.$transaction([
    db.trip.update({
      where: { id },
      data: {
        status: "ASSIGNED",
        overrideReason: reason.trim(),
        overriddenById: s.userId ?? null,
        overriddenAt: new Date(),
        approvedById: s.userId ?? null,
        approvedAt: new Date(),
      },
    }),
    db.tripEvent.create({
      data: {
        tripId: id,
        fromStatus: trip.status,
        toStatus: "ASSIGNED",
        note: `OVERRIDE: ${reason.trim()}`,
        byUserId: s.userId ?? null,
      },
    }),
  ]);
  await writeAudit("Trip", id, "UPDATE", { after: { override: true, reason: reason.trim() } });
  revalidatePath(`/${locale}/transport/planner`);
  return { ok: true };
}
