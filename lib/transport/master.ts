import "server-only";
import { db } from "@/lib/db";
import { displayName } from "@/lib/names";
import { toNumber } from "@/lib/money";
import { loadTransportConfig } from "./settings";
import { loadDayTrips } from "./trip-data";
import { dayAxis, type DayAxis } from "./axis";
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
  /** True when this lesson collides with another in the same lane. */
  conflicts: boolean;
};

/** A ride, already validated, drawn between the lessons it connects. */
export type MasterTrip = {
  id: string;
  tripKind: string;
  startMin: number;
  endMin: number;
  validationStatus: string;
  driverName: string | null;
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
};

const PLANNABLE = ["DRAFT", "SCHEDULED", "CHECKED_IN", "COMPLETED"];

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
  opts: { laneKind?: LaneKind } = {},
): Promise<MasterBoard> {
  const laneKind = opts.laneKind ?? "TEACHER";
  const { start, end } = dayBounds(day);

  const [config, sessions, trips, stopOwners] = await Promise.all([
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
      where: { trip: { date: start }, passengerTeacherId: { not: null } },
      select: { tripId: true, passengerTeacherId: true, seq: true },
      orderBy: { seq: "asc" },
    }),
  ]);

  const teacherOfTrip = new Map<string, string>();
  for (const st of stopOwners) {
    if (st.passengerTeacherId && !teacherOfTrip.has(st.tripId)) {
      teacherOfTrip.set(st.tripId, st.passengerTeacherId);
    }
  }

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
      l = { id, kind: laneKind, name, subtitle, sessions: [], trips: [], centreBands: [], uncoveredMin: 0 };
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
      conflicts: false,
    });
  }

  // --- attach trips to the lane of whoever they carry ----------------------
  for (const t of trips) {
    if (laneKind !== "TEACHER") continue;
    const pid = teacherOfTrip.get(t.id);
    if (!pid) continue;
    const lane = lanes.get(pid);
    if (!lane) continue; // a trip for a teacher whose lessons are filtered out
    lane.trips.push({
      id: t.id,
      tripKind: t.tripKind ?? "CHAIN",
      startMin: t.plannedStartMin,
      endMin: t.plannedEndMin,
      validationStatus: t.validationStatus ?? "VALID",
      driverName: t.driverName ?? null,
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
    for (const s of lane.sessions) s.conflicts = clashing.has(s.id);

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
  };
}
