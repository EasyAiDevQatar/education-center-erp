"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { transportEnabled } from "@/lib/transport/settings";
import { generateDayTrips, buildDayPlan } from "@/lib/transport/trip-data";
import { aiChat } from "@/lib/ai/client";
import { loadAiConfig, aiReady } from "@/lib/ai/config";
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

  const trip = await db.trip.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!trip) return { error: "notfound" };
  const from = trip.status as TripStatus;
  if (!canTransition(from, to)) return { error: "badTransition" };

  await db.$transaction([
    db.trip.update({ where: { id }, data: { status: to } }),
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
  const proposed = await db.trip.findMany({
    where: { date: start, status: "PROPOSED" },
    select: { id: true },
  });

  // One at a time on purpose: a single rejected row must not abort the whole
  // approval (the pattern staff-flow got right and we kept).
  let approved = 0;
  for (const t of proposed) {
    try {
      await db.$transaction([
        db.trip.update({ where: { id: t.id }, data: { status: "ASSIGNED" } }),
        db.tripEvent.create({
          data: { tripId: t.id, fromStatus: "PROPOSED", toStatus: "ASSIGNED", byUserId: s.userId ?? null },
        }),
      ]);
      approved++;
    } catch {
      // Skip and keep going; the board will still show whatever failed.
    }
  }
  await writeAudit("Trip", `approve-all-${day}`, "UPDATE", { after: { approved } });
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
  const cfg = await loadAiConfig();
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
    { maxTokens: 3000, timeoutMs: 60_000 },
  );
  if (!r.ok) {
    console.error("[aiBriefing] chat failed:", r.error, r.detail?.slice(0, 300));
    return { error: r.error };
  }
  return { ok: true, message: r.text.trim() };
}
