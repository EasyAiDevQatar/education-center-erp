import "server-only";
import { db } from "@/lib/db";
import { displayName } from "@/lib/names";
import { toNumber } from "@/lib/money";
import { loadTransportConfig } from "./settings";
import { buildDayPlan, loadDayTrips } from "./trip-data";
import { dayAxis, type DayAxis } from "./axis";
import { driverIsDispatchable } from "./fleet";
import { classifyGaps, type ClassifiedGap, type Commitment } from "./gaps";
import { lockReasonFor, type LockReason } from "./drag-lock";
import type { SessionType } from "@/lib/enums";
import {
  uncoveredMinutes,
  overlappingSessions,
  mergeSpans,
  type SessionWindow,
} from "./feasibility";

/**
 * The master planner's reader: one day, one timeline, several perspectives.
 *
 * The dispatch board answers "what is each driver doing", and its reader is
 * built around that — a lane IS a driver, all the way down. Asking it what a
 * teacher's day looks like means rewriting it, which is why this is a separate
 * reader rather than a flag on that one.
 *
 * The lane axis is a PARAMETER here from the first version, even though only
 * TEACHER is implemented. Driver and vehicle perspectives then become new
 * groupings of the same segments rather than another reader, and the dispatch
 * board can eventually retire into being one of these views.
 */

export type LaneKind = "TEACHER" | "DRIVER" | "VEHICLE";

/** A lesson, drawn as a period rather than a point. */
export type MasterSession = {
  id: string;
  label: string;
  startMin: number;
  endMin: number;
  /** CENTER | HOME — a home visit is what makes transport necessary. */
  location: string;
  status: string;
  /** Drives the timing policy: an exam is never moved, a revision block can be. */
  sessionType: SessionType;
  /** When it starts — the only honest source for "is this in the past". */
  startsAt: Date;
  /** True when this lesson collides with another in the same lane. */
  conflicts: boolean;
  /**
   * Whether a ride actually delivers them to this lesson, and takes them on
   * from it. A lesson with only one side is a person who arrives and is then
   * stranded, or who is collected from somewhere nobody took them.
   *
   * Null when no journey is required on that side at all — the engine's leg
   * chain decides that, so two centre lessons in a row are not each accused of
   * missing a ride between them.
   */
  rideIn: boolean | null;
  rideOut: boolean | null;
  /**
   * Null when this lesson may be dragged; otherwise WHY it may not.
   *
   * Computed on the server, alongside the data it judges, so the board cannot
   * offer a move the save path would refuse — and so the reason shown is the
   * real one rather than a guess reconstructed in the browser.
   */
  lockReason: LockReason | null;
};

/** A ride, already validated, drawn between the lessons it connects. */
export type MasterTrip = {
  id: string;
  tripKind: string;
  startMin: number;
  endMin: number;
  validationStatus: string;
  /** Lifecycle, not validity: PROPOSED | ASSIGNED | STARTED | COMPLETED … */
  status: string;
  /** Straight-line km, for the day's totals. */
  estimatedKm: number;
  driverName: string | null;
  /** Who is aboard — the answer to "who is this car carrying?". */
  passengerName: string | null;
  /**
   * `day:TEACHER:<id>` — the passenger this ride serves.
   *
   * Carried so a ride can be dragged back to the pool: that is the key
   * `unassignPassenger` takes, and without it the only way to undo an
   * assignment was to remember having made it.
   */
  linkGroup: string | null;
  /**
   * The lessons this ride exists for.
   *
   * Carried on the trip itself so a driver's or vehicle's row can say what the
   * journey is FOR. Without it those rows show bars moving across a day with
   * no way to tell which lesson a car is heading to, which is most of what a
   * dispatcher needs to know.
   */
  serves: { id: string; label: string; startMin: number; endMin: number; location: string }[];
  stops: { seq: number; kind: string; label: string; plannedMin: number; lat: number; lng: number }[];
};

export type MasterLane = {
  id: string;
  kind: LaneKind;
  name: string;
  /** Secondary line — plate, phone, whatever identifies the lane. */
  subtitle: string | null;
  sessions: MasterSession[];
  trips: MasterTrip[];
  /**
   * Merged spans during which the person is teaching at the centre.
   *
   * Kept separate from `sessions` because hidden must not mean ignored: with
   * centre lessons toggled off, a wall of them collapses to one muted band so
   * the row still reads as occupied. A blank stretch has to mean free.
   */
  centreBands: { startMin: number; endMin: number }[];
  /**
   * Every uncovered stretch, classified. Nothing on a row is left blank
   * without a reason — that is how a missing ride hid as empty space.
   */
  gaps: ClassifiedGap[];
  /**
   * Minutes in the lane's span that are neither a lesson nor a ride.
   *
   * Computed, never inferred from the gap between two trips: a teacher dropped
   * at 13:45 and collected at 19:42 who taught throughout was not waiting, and
   * calling that six hours of idle time would be plainly wrong.
   */
  uncoveredMin: number;
};

export type MasterBoard = {
  day: string;
  laneKind: LaneKind;
  axis: DayAxis;
  lanes: MasterLane[];
  /** Count for the toggle's badge. */
  centreSessionCount: number;
  transportEnabled: boolean;
  /** Waiting past this is drawn as a problem, not just shown. */
  maxWaitMin: number;
  /**
   * Passengers the allocator could not place — the work still to be given out.
   *
   * Carried on the board rather than fetched separately so the pool and the
   * lanes are always the same day's answer; two reads could disagree, and a
   * dispatcher dropping a card would be acting on the older one.
   */
  pool: {
    /** `TEACHER:<id>` — what the assign actions take. */
    passengerKey: string;
    passengerName: string;
    reason: string;
    /** Earliest lesson the day hinges on, for urgency. */
    needByMin: number | null;
  }[];
  /** May this user move anything at all? Role-gated, decided on the server. */
  canDrag: boolean;
  /** The centre, so a stop can be told apart from a home without a second read. */
  centre: { lat: number; lng: number } | null;
};

const PLANNABLE = ["DRAFT", "SCHEDULED", "CHECKED_IN", "COMPLETED"];

/** Trip statuses that mean a driver has been committed to the journey. */
const DISPATCHED_TRIP = new Set(["ASSIGNED", "STARTED", "COMPLETED"]);

/** Lessons that are no longer a plan — nothing about them is still to arrange. */
const SETTLED_SESSION = new Set(["COMPLETED", "CHECKED_IN", "CANCELLED", "NO_SHOW"]);

const dayBounds = (dayIso: string) => {
  const start = new Date(`${dayIso}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
};

const minutesOf = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

/**
 * Build the board for one day.
 *
 * Everything is returned; the client decides what to draw. Filtering on the
 * server would make each toggle a round-trip, and — worse — a centre lesson
 * that was never sent could not contribute to the occupied band, so hiding it
 * would silently make a busy teacher look free.
 */
export async function masterBoard(
  locale: string,
  day: string,
  opts: { laneKind?: LaneKind; canDrag?: boolean } = {},
): Promise<MasterBoard> {
  const laneKind = opts.laneKind ?? "TEACHER";
  const canDrag = opts.canDrag ?? false;
  const { start, end } = dayBounds(day);

  const [config, sessions, trips, stopOwners, tripOwners] = await Promise.all([
    loadTransportConfig(),
    db.session.findMany({
      where: { date: { gte: start, lt: end }, status: { in: PLANNABLE } },
      include: { student: true, teacher: true },
      orderBy: { date: "asc" },
    }),
    loadDayTrips(locale, day),
    // BoardTrip.stops carries a passenger NAME, not an id, which is fine for a
    // card but cannot key a lane. Read the ids straight from the stop rows.
    db.tripStop.findMany({
      where: { trip: { date: start } },
      select: { tripId: true, passengerTeacherId: true, sessionId: true, seq: true, kind: true },
      orderBy: { seq: "asc" },
    }),
    // Who and what ran each trip. BoardTrip carries a driver NAME and a plate,
    // which label a card but cannot key a lane.
    db.trip.findMany({
      where: { date: start },
      select: {
        id: true,
        status: true,
        driverId: true,
        vehicleId: true,
        vehicle: { select: { plate: true, model: true } },
        driver: { select: { employee: { select: { name: true } } } },
      },
    }),
  ]);

  const teacherOfTrip = new Map<string, string>();
  for (const st of stopOwners) {
    if (st.passengerTeacherId && !teacherOfTrip.has(st.tripId)) {
      teacherOfTrip.set(st.tripId, st.passengerTeacherId);
    }
  }
  const ownerOfTrip = new Map(tripOwners.map((t) => [t.id, t]));

  const servedByTrip = new Map<string, Set<string>>();
  for (const st of stopOwners) {
    if (!st.sessionId) continue;
    const set = servedByTrip.get(st.tripId) ?? new Set<string>();
    set.add(st.sessionId);
    servedByTrip.set(st.tripId, set);
  }
  const sessionById = new Map(sessions.map((x) => [x.id, x]));

  // Which side of each lesson a ride actually covers. A DROPOFF at a lesson is
  // the arrival; a PICKUP from it is the way onward.
  // Which lessons actually REQUIRE a ride, from the engine's own leg chain
  // rather than a guess about location. Two centre lessons in a row generate
  // no leg between them, so the second is not missing anything; a centre
  // lesson reached after a home visit does generate one, and until now that
  // one went unflagged because it was not at a home.
  const needsIn = new Set<string>();
  const needsOut = new Set<string>();
  const pool: MasterBoard["pool"] = [];
  let legs: Awaited<ReturnType<typeof buildDayPlan>>["legs"] = [];
  let reasonOfLeg = new Map<string, string>();
  try {
    const plan = await buildDayPlan(locale, day);
    reasonOfLeg = new Map(plan.unassigned.map((u) => [u.legId, u.reason]));
    legs = plan.legs;
    for (const leg of plan.legs) {
      if (leg.toSessionId) needsIn.add(leg.toSessionId);
      if (leg.fromSessionId) needsOut.add(leg.fromSessionId);
    }
  } catch {
    // The board is still worth drawing when the routing engine is unreachable;
    // it just cannot say who is missing a ride, so it says nothing rather than
    // marking every lesson as fine.
  }

  const droppedAt = new Set<string>();
  const collectedFrom = new Set<string>();
  for (const st of stopOwners) {
    if (!st.sessionId) continue;
    (st.kind === "PICKUP" ? collectedFrom : droppedAt).add(st.sessionId);
  }

  // Lessons whose ride has left the proposal stage. Moving one of these means
  // moving a car that is already committed — a driver may literally be on the
  // road for it — so the board must refuse rather than silently re-plan.
  const dispatched = new Set<string>();
  for (const st of stopOwners) {
    if (!st.sessionId) continue;
    if (DISPATCHED_TRIP.has(ownerOfTrip.get(st.tripId)?.status ?? "")) {
      dispatched.add(st.sessionId);
    }
  }

  // What a dispatcher still has to hand out: journeys with nobody driving
  // them. NOT the allocator's own unassigned list — that says "I could not
  // place this", and a journey it could have placed but which was never
  // generated is just as undriven and just as much work. This is the same
  // question the board's red edge marks answer, asked per passenger.
  {
    const byKey = new Map<string, MasterBoard["pool"][number]>();
    for (const leg of legs) {
      const covered = leg.toSessionId
        ? droppedAt.has(leg.toSessionId)
        : leg.fromSessionId
          ? collectedFrom.has(leg.fromSessionId)
          : false;
      if (covered) continue;
      const key = `${leg.passengerKind}:${leg.passengerId}`;
      const prior = byKey.get(key);
      if (!prior || (prior.needByMin ?? Infinity) > leg.dueMin) {
        byKey.set(key, {
          passengerKey: key,
          passengerName: leg.passengerName,
          reason: reasonOfLeg.get(leg.id) ?? "notPlanned",
          needByMin: leg.dueMin,
        });
      }
    }
    pool.push(...[...byKey.values()].sort((a, b) => (a.needByMin ?? 0) - (b.needByMin ?? 0)));
  }

  /**
   * Which lane a trip belongs to, and how that lane is labelled — the ONLY
   * thing that differs between perspectives. Everything downstream (gaps,
   * conflicts, axis, rendering) is shared, which is what makes a perspective a
   * grouping rather than another board.
   */
  const laneOfTrip = (tripId: string): { id: string; name: string; subtitle: string | null } | null => {
    const o = ownerOfTrip.get(tripId);
    if (laneKind === "DRIVER") {
      if (!o?.driverId) return null;
      return {
        id: o.driverId,
        name: o.driver?.employee.name ?? o.driverId,
        subtitle: o.vehicle?.plate ?? null,
      };
    }
    if (laneKind === "VEHICLE") {
      if (!o?.vehicleId) return null;
      return {
        id: o.vehicleId,
        name: o.vehicle?.plate ?? o.vehicleId,
        subtitle: o.vehicle?.model ?? null,
      };
    }
    const tid = teacherOfTrip.get(tripId);
    return tid ? { id: tid, name: "", subtitle: null } : null;
  };

  // Count only what the layer can actually reveal. Session.teacherId is
  // nullable — a walk-in is recorded before anyone knows who taught it — and
  // the lane loop below drops those, so counting them here made the badge
  // promise blocks that never appear when the layer is switched on.
  const centreSessionCount = sessions.filter(
    (s) => s.location === "CENTER" && s.teacher,
  ).length;

  // --- group sessions into lanes ------------------------------------------
  const lanes = new Map<string, MasterLane>();
  const laneFor = (id: string, name: string, subtitle: string | null): MasterLane => {
    let l = lanes.get(id);
    if (!l) {
      l = { id, kind: laneKind, name, subtitle, sessions: [], trips: [], centreBands: [], gaps: [], uncoveredMin: 0 };
      lanes.set(id, l);
    }
    return l;
  };

  for (const s of sessions) {
    if (laneKind !== "TEACHER" || !s.teacher) continue;
    const lane = laneFor(s.teacher.id, displayName(s.teacher, locale), s.teacher.phone ?? null);
    const startMin = minutesOf(s.date);
    lane.sessions.push({
      id: s.id,
      label: displayName(s.student, locale),
      startMin,
      endMin: startMin + Math.round(toNumber(s.hours) * 60),
      location: s.location,
      status: s.status,
      sessionType: (s.sessionType ?? "REGULAR") as SessionType,
      startsAt: s.date,
      conflicts: false,
      // null = no journey is required for this side, so nothing is missing.
      // false = one is required and nobody is driving it.
      //
      // A lesson that has already been taught is never missing a ride: whatever
      // happened, happened, and nobody is going to plan a car for it now.
      // Marking eight finished lessons as needing transport is how a board full
      // of red teaches people to stop reading the red.
      rideIn: SETTLED_SESSION.has(s.status) ? null : needsIn.has(s.id) ? droppedAt.has(s.id) : null,
      rideOut: SETTLED_SESSION.has(s.status)
        ? null
        : needsOut.has(s.id)
          ? collectedFrom.has(s.id)
          : null,
      lockReason: null, // decided below, once collisions are known
    });
  }

  // --- every driver and vehicle gets a row, busy or not --------------------
  //
  // Lanes used to be created BY trips, so anyone with nothing booked simply was
  // not on the board. That is precisely backwards for a dispatcher: the row you
  // most want is the idle one, and an empty row is the answer to "who is free?"
  // It also made the row unavailable as a drop target, which is the whole point
  // of a driver view you can assign on.
  if (laneKind === "DRIVER") {
    const roster = await db.driver.findMany({
      where: { active: true },
      include: {
        employee: { select: { name: true, nameEn: true } },
        defaultVehicle: { select: { plate: true } },
      },
    });
    const today = new Date();
    for (const d of roster) {
      if (!driverIsDispatchable({ active: d.active, licenceExpiry: d.licenceExpiry }, today)) continue;
      laneFor(d.id, displayName(d.employee, locale), d.defaultVehicle?.plate ?? null);
    }
  } else if (laneKind === "VEHICLE") {
    const fleet = await db.vehicle.findMany({
      where: { active: true },
      select: { id: true, plate: true, model: true },
    });
    for (const v of fleet) laneFor(v.id, v.plate, v.model);
  }

  // --- attach trips to the lane of whoever they carry ----------------------
  for (const t of trips) {
    const owner = laneOfTrip(t.id);
    if (!owner) continue;
    // A teacher's lane already exists from their lessons; a driver's or
    // vehicle's is created here, because a driver has no lessons to create it.
    const lane =
      laneKind === "TEACHER"
        ? lanes.get(owner.id)
        : laneFor(owner.id, owner.name, owner.subtitle);
    if (!lane) continue; // a ride for a teacher with no lessons on this day
    lane.trips.push({
      id: t.id,
      tripKind: t.tripKind ?? "CHAIN",
      startMin: t.plannedStartMin,
      endMin: t.plannedEndMin,
      validationStatus: t.validationStatus ?? "VALID",
      status: t.status ?? "PROPOSED",
      estimatedKm: t.estimatedKm ?? 0,
      driverName: t.driverName ?? null,
      passengerName: t.passengerName ?? null,
      linkGroup: t.linkGroup ?? null,
      serves: [...(servedByTrip.get(t.id) ?? [])]
        .map((sid) => sessionById.get(sid))
        .filter((x): x is NonNullable<typeof x> => !!x)
        .map((x) => {
          const startMin = minutesOf(x.date);
          return {
            id: x.id,
            label: displayName(x.student, locale),
            startMin,
            endMin: startMin + Math.round(toNumber(x.hours) * 60),
            location: x.location,
          };
        })
        .sort((a, b) => a.startMin - b.startMin),
      stops: t.stops.map((st) => ({
        seq: st.seq,
        kind: st.kind,
        label: st.label,
        plannedMin: st.plannedMin,
        lat: st.lat,
        lng: st.lng,
      })),
    });
  }

  // How old each lesson is, in whole days. Negative in the future. The clock
  // is the only thing that knows; the status column merely claims.
  const now = Date.now();
  const daysOldOf = (d: Date) => Math.floor((now - d.valueOf()) / 86400000);

  // --- flag collisions and measure genuinely uncovered time ---------------
  for (const lane of lanes.values()) {
    const windows: SessionWindow[] = lane.sessions.map((s) => ({
      sessionId: s.id,
      label: s.label,
      startMin: s.startMin,
      endMin: s.endMin,
    }));
    const clashing = new Set<string>();
    for (const c of overlappingSessions(windows)) {
      clashing.add(c.a.sessionId);
      clashing.add(c.b.sessionId);
    }
    for (const s of lane.sessions) {
      s.conflicts = clashing.has(s.id);
      // Only now: whether a clash locks a lesson is the centre's setting, and
      // a clash is not known until the whole lane has been read.
      s.lockReason = lockReasonFor(
        {
          status: s.status,
          sessionType: s.sessionType,
          conflicts: s.conflicts,
          tripDispatched: dispatched.has(s.id),
          daysOld: daysOldOf(s.startsAt),
        },
        {
          canDrag,
          lockConflicted: config.lockConflictedSessions,
          graceDays: config.editPastDays,
        },
      );
    }

    lane.centreBands = mergeSpans(
      lane.sessions.filter((s) => s.location === "CENTER"),
    );

    // Everything the lane is committed to — lessons AND rides — so a ride is
    // never counted as free time.
    const busy: SessionWindow[] = [
      ...windows,
      ...lane.trips.map((t) => ({
        sessionId: t.id,
        label: t.tripKind,
        startMin: t.startMin,
        endMin: t.endMin,
      })),
    ];
    const from = Math.min(...busy.map((b) => b.startMin));
    const to = Math.max(...busy.map((b) => b.endMin));
    lane.uncoveredMin = busy.length ? uncoveredMinutes(busy, from, to) : 0;

    // Classify the holes. A lesson and a ride are both commitments; what is
    // left over is what the row must explain.
    const commitments: Commitment[] = [
      ...lane.sessions.map((x) => ({
        id: x.id,
        startMin: x.startMin,
        endMin: x.endMin,
        kind: (x.location === "HOME" ? "LESSON_HOME" : "LESSON_CENTRE") as Commitment["kind"],
      })),
      ...lane.trips.map((x) => ({
        id: x.id,
        startMin: x.startMin,
        endMin: x.endMin,
        kind: "TRIP" as const,
      })),
    ];
    lane.gaps = classifyGaps(commitments, {
      maxWaitMin: config.rules.maxStudentWaitMin,
      subject: laneKind === "TEACHER" ? "PASSENGER" : "DRIVER",
    });

    lane.sessions.sort((a, b) => a.startMin - b.startMin);
    lane.trips.sort((a, b) => a.startMin - b.startMin);
  }

  const marks: number[] = [];
  for (const lane of lanes.values()) {
    for (const s of lane.sessions) marks.push(s.startMin, s.endMin);
    for (const t of lane.trips) marks.push(t.startMin, t.endMin);
  }

  return {
    day,
    laneKind,
    axis: dayAxis(marks),
    lanes: [...lanes.values()].sort((a, b) => a.name.localeCompare(b.name, locale)),
    centreSessionCount,
    transportEnabled: config.enabled,
    maxWaitMin: config.rules.maxStudentWaitMin,
    pool,
    canDrag,
    centre: config.centre ?? null,
  };
}
