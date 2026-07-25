import "server-only";
import { db } from "@/lib/db";
import { displayName } from "@/lib/names";
import { toNumber } from "@/lib/money";
import { loadTransportConfig } from "./settings";
import { loadDayTrips } from "./trip-data";
import { dayAxis, type DayAxis } from "./axis";
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
  /** True when this lesson collides with another in the same lane. */
  conflicts: boolean;
  /**
   * Whether a ride actually delivers them to this lesson, and takes them on
   * from it. Every lesson a transported person attends wants both; a lesson
   * with only one side is a person who arrives and is then stranded, or who
   * is collected from somewhere nobody took them.
   *
   * Null when the person drives themselves — the question does not arise.
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
  driverName: string | null;
  /** Who is aboard — the answer to "who is this car carrying?". */
  passengerName: string | null;
  /**
   * The lessons this ride exists for.
   *
   * Carried on the trip itself so a driver's or vehicle's row can say what the
   * journey is FOR. Without it those rows show bars moving across a day with
   * no way to tell which lesson a car is heading to, which is most of what a
   * dispatcher needs to know.
   */
  serves: { id: string; label: string; startMin: number; endMin: number; location: string }[];
  stops: { seq: number; kind: string; label: string; plannedMin: number }[];
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
  /** May this user move anything at all? Role-gated, decided on the server. */
  canDrag: boolean;
};

const PLANNABLE = ["DRAFT", "SCHEDULED", "CHECKED_IN", "COMPLETED"];

/** Trip statuses that mean a driver has been committed to the journey. */
const DISPATCHED_TRIP = new Set(["ASSIGNED", "STARTED", "COMPLETED"]);

const dayBounds = (dayIso: string) => {
  const start = new Date(`${dayIso}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
};

const minutesOf = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

/** A lesson that cannot happen unless somebody is driven to it. */
const needsRide = (s: { location: string; teacher: { transportMode: string | null } | null }) =>
  s.location === "HOME" && s.teacher != null && s.teacher.transportMode !== "OWN_CAR";

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
      conflicts: false,
      // Only where travel is definitionally required. A home visit cannot
      // happen without somebody being driven to it and away from it again.
      //
      // Deliberately NOT every lesson: two centre lessons in a row need no
      // ride between them, and flagging the second as missing one would paint
      // a normal day red. Whether a CENTRE lesson needs a ride depends on
      // where the person was beforehand — that is the leg chain's question,
      // and this reader does not build legs.
      rideIn: needsRide(s) ? droppedAt.has(s.id) : null,
      rideOut: needsRide(s) ? collectedFrom.has(s.id) : null,
      lockReason: null, // decided below, once collisions are known
    });
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
      driverName: t.driverName ?? null,
      passengerName: t.passengerName ?? null,
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
      })),
    });
  }

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
        },
        { canDrag, lockConflicted: config.lockConflictedSessions },
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
    canDrag,
  };
}
