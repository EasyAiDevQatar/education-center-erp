"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { guardArchived } from "@/lib/academic-year";
import { notifySession } from "@/lib/integrations/notify";
import { displayName } from "@/lib/names";
import { toNumber } from "@/lib/money";
import { findConflicts, weekdayOf, type Conflict } from "@/lib/conflicts";
import { suggestFreeStart } from "@/lib/conflict-suggest";
import { spacingProblems, suggestStart, type SpacedSession } from "@/lib/transport/spacing";
import { lockReasonFor, type LockReason } from "@/lib/transport/drag-lock";
import { legFeasibility } from "@/lib/transport/feasibility";
import { allocate, type Assignment, type Unassigned } from "@/lib/transport/allocate";
import { comparePlans, EMPTY_METRICS, type PlanMetrics } from "@/lib/transport/cost";
import { buildDayPlan, flagTripsForSession, type DayPlan } from "@/lib/transport/trip-data";
import { transportEnabled, loadTransportConfig, distanceKm } from "@/lib/transport/settings";
import { previewAssignAll } from "../dispatch/actions";
import type { Leg } from "@/lib/transport/chain";
import type { Role, SessionType } from "@/lib/enums";

/**
 * Moving a lesson from the master planner: look first, then agree, then write.
 *
 * Dragging produces a proposal, not a change. This is the seam where a
 * proposal becomes a question — "here is what this would cost you" — and only
 * then, on a second deliberate click, a write.
 *
 * The split is the whole point. Re-timing one lesson re-times the car that
 * serves it, the driver on that car, and possibly a second lesson at the other
 * end of the day; committing that on mouse-up would be a change nobody
 * reviewed. So `previewReschedule` answers the question and writes nothing a
 * user can see, and `confirmReschedule` does exactly what the session edit
 * form does — no more, and importantly no less.
 */

/** Only these may re-time a lesson. Matches what the board offers. */
const DRAG_ROLES: Role[] = ["ADMIN", "RECEPTIONIST"];

async function guard(): Promise<string | null> {
  const s = await getSession();
  if (!s || !STAFF_ROLES.includes(s.role)) return "forbidden";
  if (!DRAG_ROLES.includes(s.role)) return "forbidden";
  // The page is gated on the module too. Without this the write would outlive
  // the board it belongs to: switch transport off and the action still moves
  // lessons by the transport rules.
  if (!(await transportEnabled())) return "forbidden";
  return null;
}

const moveSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sessionId: z.string().min(1),
  /**
   * Where the user believed the lesson was when they dragged it.
   *
   * This is the baseline for the whole exchange. Without it a confirm sent
   * minutes later would re-base onto whatever the row says NOW and write the
   * proposed time anyway — a lost update that also notifies a family about a
   * move the user never saw.
   */
  fromStartMin: z.number().int().min(0).max(1439),
  toStartMin: z.number().int().min(0).max(1439),
});

export type MoveInput = z.infer<typeof moveSchema>;

/** Why a move is refused. Every one of these has an ar/en message. */
export type BlockerCode =
  /** Someone else moved, finished or cancelled it since the board loaded. */
  | "stale"
  /** Locked: finished, an exam, a dispatched ride, or a locked clash. */
  | "locked"
  /** The year is archived. */
  | "archived"
  /** Spacing says nobody can physically get there, and the centre blocks that. */
  | "noRoomToTravel"
  /** It is already there. */
  | "unchanged";

export type Blocker = { code: BlockerCode; lockReason?: LockReason };

export type ConflictView = Conflict & { studentName: string };

export type SpacingView = {
  kind: "OVERLAP" | "TOO_TIGHT";
  shortfallMin: number;
  requiredGapMin: number;
  otherLabel: string;
  otherStartMin: number;
  otherEndMin: number;
};

/** One passenger's ride, before and after. */
export type RideChange = {
  passengerName: string;
  /** null when nobody can serve it on that side. */
  beforeMin: number | null;
  afterMin: number | null;
  /** The lesson this ride exists for, so a row reads as a purpose. */
  forLabel: string | null;
};

export type ImpactPreview = {
  ok: true;
  /** Non-empty means confirm is refused. */
  blockers: Blocker[];
  from: { startMin: number; endMin: number };
  to: { startMin: number; endMin: number };
  studentName: string;
  teacherName: string;
  conflicts: ConflictView[];
  spacing: SpacingView[];
  /** Nearest clean start, when something is wrong and one exists. */
  suggestedStartMin: number | null;
  /** Ride timings that move, both directions. */
  rides: RideChange[];
  /** Passengers who would have no ride at all after the move. */
  strandedNames: string[];
  /** The operational delta, in the units the planner already speaks. */
  savingMinutes: number;
  savingKm: number;
  /** Rides that go back for re-approval if this is confirmed. */
  tripsNeedingReview: number;
  /** Who hears about it. */
  notifyNames: string[];
};

export type PreviewResult = ImpactPreview | { ok?: false; error: string };
export type ConfirmResult = { ok?: boolean; error?: string; lockReason?: LockReason };

const minutesOf = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

const dayRange = (day: string) => {
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
};

/** A day plus minutes, in the UTC the rest of the schedule is stored in. */
const dateAt = (day: string, startMin: number) =>
  new Date(`${day}T00:00:00.000Z`).valueOf() + startMin * 60000;

/** Trip statuses that mean a driver is committed. Mirrors the board reader. */
const DISPATCHED_TRIP = new Set(["ASSIGNED", "STARTED", "COMPLETED"]);
const INERT = new Set(["CANCELLED", "NO_SHOW"]);

type Gate = {
  blockers: Blocker[];
  session: NonNullable<Awaited<ReturnType<typeof loadSession>>>;
  fromStartMin: number;
  durationMin: number;
};

function loadSession(id: string) {
  return db.session.findUnique({
    where: { id },
    include: { student: true, teacher: true },
  });
}

/**
 * Everything that can refuse a move, evaluated once and shared by both actions.
 *
 * Both call this, so the preview cannot promise something the confirm will
 * refuse, and the confirm cannot accept something the preview never checked.
 * Order runs from the most fundamental refusal outward, so the reason shown is
 * the real one.
 */
async function gateFor(input: MoveInput, locale: string): Promise<Gate | { error: string }> {
  const session = await loadSession(input.sessionId);
  if (!session) return { error: "stale" };

  const blockers: Blocker[] = [];
  const durationMin = Math.round(toNumber(session.hours) * 60);
  const actualDay = session.date.toISOString().slice(0, 10);
  const actualStart = minutesOf(session.date);

  // Staleness first: everything below is arithmetic about a lesson that may no
  // longer be where the user was looking. A cross-day move computed against a
  // day the lesson has left produces plausible numbers that mean nothing.
  if (actualDay !== input.day || actualStart !== input.fromStartMin) {
    return { error: "stale" };
  }
  if (input.toStartMin === input.fromStartMin) blockers.push({ code: "unchanged" });

  // Is it still movable? Re-checked here rather than trusted from the client:
  // a board that stopped believing the lock must not be able to get a write.
  const servingTrips = await db.tripStop.findMany({
    where: { sessionId: session.id },
    select: { trip: { select: { status: true } } },
  });
  const dispatched = servingTrips.some((st) => DISPATCHED_TRIP.has(st.trip.status));
  const sameDay = await db.session.findMany({
    where: {
      date: { gte: dayRange(input.day).start, lt: dayRange(input.day).end },
      status: { notIn: [...INERT] },
    },
    include: { student: true, teacher: true },
  });
  const conflictsNow = sameDay.some(
    (o) =>
      o.id !== session.id &&
      o.teacherId === session.teacherId &&
      minutesOf(o.date) < actualStart + durationMin &&
      actualStart < minutesOf(o.date) + Math.round(toNumber(o.hours) * 60),
  );
  const config = await loadTransportConfig();
  const lockReason = lockReasonFor(
    {
      status: session.status,
      sessionType: (session.sessionType ?? "REGULAR") as SessionType,
      conflicts: conflictsNow,
      tripDispatched: dispatched,
    },
    { canDrag: true, lockConflicted: config.lockConflictedSessions },
  );
  if (lockReason) blockers.push({ code: "locked", lockReason });

  // Archived years refuse the move on both sides of the date, exactly as the
  // edit form does. Reported even when the lesson is also locked, so the
  // dialog can say every reason rather than only the first.
  const frozen = await guardArchived(
    new Date(dateAt(input.day, input.toStartMin)),
    session.date,
  );
  if (frozen) blockers.push({ code: "archived" });

  void locale;
  return { blockers, session, fromStartMin: actualStart, durationMin };
}

/**
 * Move the legs that belong to one lesson, and nothing else.
 *
 *   a leg arriving AT the lesson  → its deadline and preferred arrival move
 *   a leg leaving THE lesson      → the passenger is ready later
 *
 * Everyone else's day stays where it is, so the allocator has to fit the moved
 * ride around it rather than re-planning the world.
 */
function shiftLegs(legs: Leg[], sessionId: string, deltaMin: number): Leg[] {
  return legs.map((l) => {
    if (l.toSessionId === sessionId) {
      return { ...l, dueMin: l.dueMin + deltaMin, preferredMin: l.preferredMin + deltaMin };
    }
    if (l.fromSessionId === sessionId) {
      const readyMin = l.readyMin + deltaMin;
      // The preferred departure cannot precede the moment they are ready: a
      // lesson that now ends later drags its own ride home with it.
      return { ...l, readyMin, preferredMin: Math.max(l.preferredMin, readyMin) };
    }
    return l;
  });
}

/** Sum assignments into the units `comparePlans` speaks. */
function metricsOf(legs: Leg[], assignments: Assignment[]): PlanMetrics {
  const byId = new Map(legs.map((l) => [l.id, l]));
  const m: PlanMetrics = { ...EMPTY_METRICS };
  const drivers = new Set<string>();
  for (const a of assignments) {
    const leg = byId.get(a.legId);
    if (!leg) continue;
    drivers.add(a.driverId);
    m.tripCount += 1;
    m.latenessMinutes += Math.max(0, a.dropoffMin - leg.dueMin);
    m.waitingMinutes += Math.max(0, a.pickupMin - leg.readyMin);
    m.journeyMinutes += Math.max(0, a.dropoffMin - a.pickupMin);
    m.emptyKm += a.deadheadKm;
    m.totalKm += a.deadheadKm + distanceKm(leg.from, leg.to);
    m.driverMinutes += Math.max(0, a.dropoffMin - a.departMin);
  }
  m.vehicleCount = drivers.size;
  m.emptyKm = Math.round(m.emptyKm * 10) / 10;
  m.totalKm = Math.round(m.totalKm * 10) / 10;
  return m;
}

/**
 * Allocate one set of legs with the plan's own drivers and settings.
 *
 * The CURRENT legs are re-allocated too rather than reusing the plan's own
 * assignments: those were produced against the road-time matrix, and comparing
 * them with a straight-line re-allocation would report differences the move did
 * not cause. Both sides are computed the same way here, so every number in the
 * dialog is a consequence of the drag and nothing else.
 */
function runAllocation(plan: DayPlan, legs: Leg[]) {
  const cfg = plan.config;
  const impossible: Unassigned[] = [];
  const schedulable = legs.filter((l) => {
    if (legFeasibility({ readyMin: l.readyMin, dueMin: l.dueMin }).possible) return true;
    impossible.push({ legId: l.id, reason: "scheduleConflict" });
    return false;
  });

  const { assignments, unassigned } = allocate(
    schedulable.map((l) => ({
      id: l.id,
      from: l.from,
      to: l.to,
      readyMin: l.readyMin,
      dueMin: l.dueMin,
      preferredMin: l.preferredMin,
      passengers: 1,
    })),
    // With no centre pin every CENTER stop is meaningless — the same refusal
    // buildDayPlan makes, so the preview does not invent a plan around (0,0).
    plan.centreSet ? plan.allocDrivers : [],
    cfg.profile,
    {
      distanceKm,
      maxDeadheadKm: cfg.maxDeadheadKm,
      turnaroundMin:
        Math.max(cfg.rules.minDriverTurnaroundMin, cfg.rules.minVehicleTurnaroundMin) +
        cfg.rules.postTripCloseoutMin +
        cfg.rules.preTripInspectionMin,
      serviceMin: Math.ceil(cfg.operational.boardingTimeMin + cfg.operational.dropoffTimeMin),
    },
  );

  return { assignments, unassigned: [...impossible, ...unassigned], metrics: metricsOf(legs, assignments) };
}

/* ----------------------------------------------------------------- preview */

/**
 * What would happen if this lesson moved.
 *
 * Writes nothing a user can see. To be exact rather than reassuring: the one
 * write reachable from here is `db.routingCache.upsert` inside the cached
 * routing provider, and only when ROUTING_PROVIDER=osrm with a base URL set
 * and the key missing or expired. That table is a global memo — no company
 * column, no foreign key, safe to truncate — and the upsert already swallows
 * its own errors. It is accepted rather than avoided, on two conditions this
 * function honours: `buildDayPlan` is called exactly ONCE, and
 * `buildTripsForPassenger` is not called at all, even with persist:false —
 * that is the second cache-touching path, and its geometry fetch is pointless
 * for a dialog that draws no map.
 *
 * `generateDayTrips` is never called. It deletes and recreates the day's trips.
 */
export async function previewReschedule(
  locale: string,
  input: MoveInput,
): Promise<PreviewResult> {
  const forbidden = await guard();
  if (forbidden) return { error: forbidden };

  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const gate = await gateFor(d, locale);
  if ("error" in gate) return { error: gate.error };
  const { session, durationMin, blockers } = gate;

  const deltaMin = d.toStartMin - d.fromStartMin;
  const toEnd = d.toStartMin + durationMin;

  // --- clashes and travel room, in the vocabulary the booking forms use -----
  const { start, end } = dayRange(d.day);
  const others = await db.session.findMany({
    where: { date: { gte: start, lt: end }, status: { notIn: [...INERT] }, id: { not: session.id } },
    include: { student: true, teacher: true },
  });
  const availability = session.teacherId
    ? await db.teacherAvailability.findMany({ where: { teacherId: session.teacherId } })
    : [];

  const conflicts: ConflictView[] = findConflicts({
    candidate: {
      id: session.id,
      teacherId: session.teacherId ?? "",
      studentId: session.studentId,
      weekday: weekdayOf(d.day),
      startMin: d.toStartMin,
      hours: toNumber(session.hours),
    },
    existing: others.map((o) => ({
      id: o.id,
      teacherId: o.teacherId,
      studentId: o.studentId,
      startMin: minutesOf(o.date),
      hours: toNumber(o.hours),
      status: o.status,
      studentName: displayName(o.student, locale),
      teacherName: o.teacher ? displayName(o.teacher, locale) : "",
    })),
    availability: availability.map((a) => ({
      weekday: a.weekday,
      startMin: a.startMin,
      endMin: a.endMin,
    })),
  }).map((c) => ({ ...c, studentName: c.withName ?? "" }));

  const config = await loadTransportConfig();
  const teacherOthers: SpacedSession[] = others
    .filter((o) => o.teacherId && o.teacherId === session.teacherId)
    .map((o) => ({
      id: o.id,
      startMin: minutesOf(o.date),
      endMin: minutesOf(o.date) + Math.round(toNumber(o.hours) * 60),
      location: o.location,
    }));
  const candidate: SpacedSession = {
    id: session.id,
    startMin: d.toStartMin,
    endMin: toEnd,
    location: session.location,
  };
  const rawSpacing = config.enabled
    ? spacingProblems(candidate, teacherOthers, config.spacing)
    : [];
  const labelOf = (id?: string | null) => {
    const o = others.find((x) => x.id === id);
    return o ? displayName(o.student, locale) : "";
  };
  const spacing: SpacingView[] = rawSpacing.map((p) => {
    const o = others.find((x) => x.id === p.otherId);
    const s = o ? minutesOf(o.date) : 0;
    return {
      kind: p.kind,
      shortfallMin: p.shortfallMin,
      requiredGapMin: p.requiredGapMin,
      otherLabel: labelOf(p.otherId),
      otherStartMin: s,
      otherEndMin: o ? s + Math.round(toNumber(o.hours) * 60) : 0,
    };
  });
  // Only a configured refusal blocks. A teacher's availability window is
  // advisory everywhere else in this app and stays advisory here — it warns,
  // it does not veto.
  if (spacing.length > 0 && config.blockOverlappingBooking) {
    blockers.push({ code: "noRoomToTravel" });
  }

  const suggestedStartMin =
    conflicts.length > 0 || spacing.length > 0
      ? (spacing.length > 0
          ? suggestStart(candidate, teacherOthers, config.spacing)
          : null) ??
        suggestFreeStart({
          preferMin: d.toStartMin,
          hours: toNumber(session.hours),
          teacherId: session.teacherId ?? "",
          studentIds: [session.studentId],
          weekday: weekdayOf(d.day),
          existing: others.map((o) => ({
            id: o.id,
            teacherId: o.teacherId,
            studentId: o.studentId,
            startMin: minutesOf(o.date),
            hours: toNumber(o.hours),
            status: o.status,
          })),
          excludeId: session.id,
        })
      : null;

  // --- what it does to the cars -------------------------------------------
  let rides: RideChange[] = [];
  let strandedNames: string[] = [];
  let savingMinutes = 0;
  let savingKm = 0;
  try {
    const plan = await buildDayPlan(locale, d.day);
    const before = runAllocation(plan, plan.legs);
    const after = runAllocation(plan, shiftLegs(plan.legs, session.id, deltaMin));

    const nameOfLeg = (legId: string) => {
      const leg = plan.legs.find((l) => l.id === legId);
      return leg?.passengerName ?? "";
    };
    const pickupBefore = new Map(before.assignments.map((a) => [a.legId, a.pickupMin]));
    const pickupAfter = new Map(after.assignments.map((a) => [a.legId, a.pickupMin]));
    const legIds = new Set([...pickupBefore.keys(), ...pickupAfter.keys()]);
    for (const legId of legIds) {
      const b = pickupBefore.get(legId) ?? null;
      const a = pickupAfter.get(legId) ?? null;
      if (b === a) continue;
      const leg = plan.legs.find((l) => l.id === legId);
      rides.push({
        passengerName: nameOfLeg(legId),
        beforeMin: b,
        afterMin: a,
        forLabel: leg?.toSessionId === session.id ? displayName(session.student, locale) : null,
      });
    }
    strandedNames = after.unassigned
      .filter((u) => !before.unassigned.some((x) => x.legId === u.legId))
      .map((u) => nameOfLeg(u.legId))
      .filter(Boolean);

    // Plain differences, negatives included: a move that saves a car but adds
    // kilometres has to say both, or the dialog is an advert rather than a
    // summary.
    const cmp = comparePlans(before.metrics, after.metrics);
    savingMinutes = cmp.driverMinutesSaved;
    savingKm = cmp.kmSaved;
  } catch {
    // A transport engine that cannot answer is not a reason to refuse a move:
    // the lesson still exists, the clash checks above still hold, and the
    // dialog simply says nothing about cars rather than inventing numbers.
    rides = [];
  }

  const affectedTrips = await db.tripStop.findMany({
    where: { sessionId: session.id, trip: { status: { notIn: ["CANCELLED", "COMPLETED"] } } },
    select: { tripId: true },
  });

  return {
    ok: true,
    blockers,
    from: { startMin: d.fromStartMin, endMin: d.fromStartMin + durationMin },
    to: { startMin: d.toStartMin, endMin: toEnd },
    studentName: displayName(session.student, locale),
    teacherName: session.teacher ? displayName(session.teacher, locale) : "",
    conflicts,
    spacing,
    suggestedStartMin,
    rides: rides.sort((a, b) => (a.afterMin ?? 0) - (b.afterMin ?? 0)),
    strandedNames,
    savingMinutes,
    savingKm,
    tripsNeedingReview: new Set(affectedTrips.map((x) => x.tripId)).size,
    notifyNames: [displayName(session.student, locale)],
  };
}

/* ----------------------------------------------------------------- confirm */

/**
 * Apply the move.
 *
 * Follows the session EDIT FORM's path, not the calendar drag's: the calendar
 * moves a session without flagging its trips or notifying anybody, and a ride
 * left approved against a lesson that has moved is exactly the failure this
 * board exists to make visible.
 *
 * It writes ONE field. A drag changes the clock and nothing else, so
 * pricePerHour, total and paymentStatus are left alone. Re-resolving the price
 * from the matrix — as the edit form legitimately does, because it can also
 * change grade, location and hours — would silently overwrite a group
 * booking's negotiated per-student price, and write 0 where the matrix has no
 * rule for that grade and location.
 */
export async function confirmReschedule(
  locale: string,
  input: MoveInput,
): Promise<ConfirmResult> {
  const forbidden = await guard();
  if (forbidden) return { error: forbidden };

  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  // Re-gated at the moment of writing, against the baseline the user saw. A
  // preview read minutes ago proves nothing about now.
  const gate = await gateFor(d, locale);
  if ("error" in gate) return { error: gate.error };
  if (gate.blockers.length > 0) {
    const first = gate.blockers[0];
    return { error: first.code, lockReason: first.lockReason };
  }

  const date = new Date(dateAt(d.day, d.toStartMin));
  await db.session.update({ where: { id: d.sessionId }, data: { date } });
  // The ride serving it was planned against the old clock: send it back for
  // review rather than leaving an approved trip that no longer fits.
  await flagTripsForSession(d.sessionId, "SESSION_CHANGED");
  await writeAudit("Session", d.sessionId, "UPDATE", {
    after: { date, movedFromMin: d.fromStartMin, movedToMin: d.toStartMin },
  });
  await notifySession("SESSION_RESCHEDULED", d.sessionId);

  revalidatePath(`/${locale}/transport/master`);
  revalidatePath(`/${locale}/transport/dispatch`);
  revalidatePath(`/${locale}/sessions`);
  revalidatePath(`/${locale}/calendar`);
  return { ok: true };
}

/* -------------------------------------------- a ride for an unplanned gap */

export type DriverOption = {
  driverId: string;
  name: string;
  plate: string | null;
  /** The validation the ride WOULD get on this driver. */
  status: string;
  /** False when this driver cannot serve the journey at all. */
  feasible: boolean;
};

/**
 * Which drivers could serve this person's unplanned travel, and how well.
 *
 * A red gap on the board says "they have to be somewhere else and no ride is
 * planned". That is the one gap kind with an obvious next action, so it gets
 * one — but the board knows nothing about drivers, and offering a list without
 * saying which of them can actually make it would just move the guesswork.
 *
 * Read-only: `previewAssignAll` is the dispatch board's own hover-preview, and
 * it writes nothing. Names are joined here because it returns ids alone.
 */
export async function driverOptionsFor(
  locale: string,
  day: string,
  passengerKey: string,
): Promise<{ ok: true; drivers: DriverOption[] } | { ok?: false; error: string }> {
  const forbidden = await guard();
  if (forbidden) return { error: forbidden };

  const preview = await previewAssignAll(locale, day, passengerKey);
  if (!preview.ok) return { error: preview.error };

  const rows = await db.driver.findMany({
    where: { id: { in: preview.drivers.map((d) => d.driverId) } },
    select: {
      id: true,
      employee: { select: { name: true, nameEn: true } },
      defaultVehicle: { select: { plate: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  return {
    ok: true,
    drivers: preview.drivers
      .map((d) => ({
        driverId: d.driverId,
        // Every other transport reader localises the name; this one was
        // showing Latin script on the Arabic board.
        name: (() => {
          const e = byId.get(d.driverId)?.employee;
          return e ? displayName(e, locale) : d.driverId;
        })(),
        plate: byId.get(d.driverId)?.defaultVehicle?.plate ?? null,
        status: d.status,
        feasible: d.feasible,
      }))
      // Whoever can actually do it first, then by how clean the ride would be.
      .sort(
        (a, b) =>
          Number(b.feasible) - Number(a.feasible) ||
          RANK[a.status] - RANK[b.status] ||
          a.name.localeCompare(b.name, locale),
      ),
  };
}

const RANK: Record<string, number> = { VALID: 0, WARNING: 1, DELAYED_EXCEPTION: 2, INVALID: 3 };
