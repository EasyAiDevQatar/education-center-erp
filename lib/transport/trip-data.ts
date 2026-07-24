import "server-only";
import { db } from "@/lib/db";
import { displayName } from "@/lib/names";
import { toNumber } from "@/lib/money";
import { loadTransportConfig, distanceKm, type TransportConfig } from "./settings";
import { travelMinutes } from "./eta";
import { buildDayLegs, type Leg, type PassengerDay, type SkippedLeg } from "./chain";
import { allocate, type AllocDriver, type Assignment, type Unassigned } from "./allocate";
import { driverIsDispatchable } from "./fleet";
import { generatorMayReplace, legKeyFor } from "./trips";
import type { TripStatus } from "@/lib/enums";

/**
 * Sessions the transport planner plans around.
 *
 * DRAFT is deliberately INCLUDED, unlike every money-facing query: the daily
 * planner creates tomorrow as drafts, and a car has to be arranged before the
 * lesson is confirmed or the plan always arrives a day late. Only sessions that
 * will definitely not happen are excluded.
 */
const PLANNABLE_STATUSES = ["DRAFT", "SCHEDULED", "CHECKED_IN", "COMPLETED"];

export type PlannedDriver = {
  id: string;
  name: string;
  capacity: number;
  plate: string | null;
  vehicleId: string | null;
  shiftStartMin: number | null;
  shiftEndMin: number | null;
};

export type DayPlan = {
  date: string;
  legs: Leg[];
  skipped: SkippedLeg[];
  assignments: Assignment[];
  unassigned: Unassigned[];
  drivers: PlannedDriver[];
  /** False when centreLat/centreLng are unset — every CENTER stop is unusable. */
  centreSet: boolean;
  config: TransportConfig;
};

const dayBounds = (dayIso: string) => {
  const start = new Date(`${dayIso}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
};

/**
 * Run the engine over one day: sessions → legs → proposed driver assignments.
 *
 * Reads only; nothing is written. The board calls this to show a preview, and
 * `generateDayTrips` calls the same function so what you approve is exactly
 * what you were shown.
 */
export async function buildDayPlan(locale: string, dayIso: string): Promise<DayPlan> {
  const config = await loadTransportConfig();
  const { start, end } = dayBounds(dayIso);

  const [sessions, driverRows] = await Promise.all([
    db.session.findMany({
      where: { date: { gte: start, lt: end }, status: { in: PLANNABLE_STATUSES } },
      include: { student: true, teacher: true },
      orderBy: { date: "asc" },
    }),
    db.driver.findMany({
      where: { active: true },
      include: { employee: true, defaultVehicle: true },
    }),
  ]);

  const centre = config.centre;
  const centreLabel = locale === "ar" ? "المركز" : "Centre";

  // Centre-wide scope: a centre that only ferries teachers should not have the
  // board fill with student legs it will never action.
  const wantTeachers = config.passengers !== "STUDENTS";
  const wantStudents = config.passengers !== "TEACHERS";

  /** Where a lesson physically happens. */
  const placeOf = (s: (typeof sessions)[number]) =>
    s.location === "HOME"
      ? s.student.homeLat != null && s.student.homeLng != null
        ? { at: { lat: s.student.homeLat, lng: s.student.homeLng }, label: s.student.homeCode ?? displayName(s.student, locale) }
        : { at: null, label: displayName(s.student, locale) }
      : { at: centre, label: centreLabel };

  const minutesOf = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

  // --- passenger days -----------------------------------------------------
  const days = new Map<string, PassengerDay>();

  for (const s of sessions) {
    const place = placeOf(s);
    const point = {
      sessionId: s.id,
      at: place.at,
      label: place.label,
      startMin: minutesOf(s.date),
      endMin: minutesOf(s.date) + Math.round(toNumber(s.hours) * 60),
    };

    // Teachers: having home coordinates IS the opt-in (see the Teacher.address
    // comment) — only teachers the centre actually collects have a pin.
    if (wantTeachers && s.teacher && s.teacher.homeLat != null && s.teacher.homeLng != null) {
      const key = `TEACHER:${s.teacher.id}`;
      if (!days.has(key)) {
        days.set(key, {
          passengerId: s.teacher.id,
          passengerKind: "TEACHER",
          name: displayName(s.teacher, locale),
          home: { lat: s.teacher.homeLat, lng: s.teacher.homeLng },
          homeLabel: s.teacher.address ?? displayName(s.teacher, locale),
          points: [],
        });
      }
      days.get(key)!.points.push(point);
    }

    // Students: explicit opt-in, because most families drive their own child.
    if (wantStudents && s.student.needsTransport && s.student.homeLat != null && s.student.homeLng != null) {
      const key = `STUDENT:${s.student.id}`;
      if (!days.has(key)) {
        days.set(key, {
          passengerId: s.student.id,
          passengerKind: "STUDENT",
          name: displayName(s.student, locale),
          home: { lat: s.student.homeLat, lng: s.student.homeLng },
          homeLabel: s.student.homeCode ?? s.student.address ?? displayName(s.student, locale),
          points: [],
        });
      }
      days.get(key)!.points.push(point);
    }
  }

  const built = buildDayLegs([...days.values()], {
    arriveEarlyMin: config.bufferMin,
  });
  // Only home-visit legs are the centre's job: a leg counts when it delivers to
  // or leaves a HOME lesson. Pure home↔centre commutes are dropped, so the board
  // mirrors the home sessions on the schedule.
  const homeSessionIds = new Set(
    sessions.filter((x) => x.location === "HOME").map((x) => x.id),
  );
  const legs = built.legs.filter(
    (l) =>
      (l.toSessionId !== null && homeSessionIds.has(l.toSessionId)) ||
      (l.fromSessionId !== null && homeSessionIds.has(l.fromSessionId)),
  );
  const skipped = built.skipped;

  // --- drivers ------------------------------------------------------------
  const today = new Date();
  const dispatchable = driverRows.filter((d) =>
    driverIsDispatchable({ active: d.active, licenceExpiry: d.licenceExpiry }, today),
  );

  const drivers: PlannedDriver[] = dispatchable.map((d) => ({
    id: d.id,
    name: displayName(d.employee, locale),
    capacity: d.defaultVehicle?.capacity ?? 4,
    plate: d.defaultVehicle?.plate ?? null,
    vehicleId: d.defaultVehicleId,
    shiftStartMin: d.shiftStartMin,
    shiftEndMin: d.shiftEndMin,
  }));

  const allocDrivers: AllocDriver[] = dispatchable.map((d) => ({
    id: d.id,
    // A driver with no home pin starts from the centre rather than being
    // dropped from the pool — the centre is where the vehicle actually lives.
    startAt:
      d.employee.homeLat != null && d.employee.homeLng != null
        ? { lat: d.employee.homeLat, lng: d.employee.homeLng }
        : (centre ?? { lat: 0, lng: 0 }),
    freeFromMin: d.shiftStartMin ?? 0,
    capacity: d.defaultVehicle?.capacity ?? 4,
    shiftStartMin: d.shiftStartMin,
    shiftEndMin: d.shiftEndMin,
  }));

  const { assignments, unassigned } = allocate(
    legs.map((l) => ({
      id: l.id,
      from: l.from,
      to: l.to,
      readyMin: l.readyMin,
      dueMin: l.dueMin,
      passengers: 1,
    })),
    // With no centre pin every CENTER stop is meaningless, so refuse to invent
    // a plan around (0,0) — the board tells the admin to set the pin instead.
    centre ? allocDrivers : [],
    config.profile,
    { distanceKm, maxDeadheadKm: config.maxDeadheadKm },
  );

  return {
    date: dayIso,
    legs,
    skipped,
    assignments,
    unassigned,
    drivers,
    centreSet: centre !== null,
    config,
  };
}

export type GenerateResult = {
  created: number;
  refreshed: number;
  /** Legs left alone because a human already acted on their trip. */
  locked: number;
  unassigned: number;
};

/**
 * Persist the plan as PROPOSED trips.
 *
 * Idempotent by [date, legKey]: re-running refreshes the generator's own
 * untouched proposals and never rewrites a trip someone has approved, started
 * or cancelled. Unassigned legs are deliberately NOT written — a trip with no
 * driver would look dispatched; they stay on the board as problems to fix.
 */
export async function generateDayTrips(
  locale: string,
  dayIso: string,
  byUserId?: string | null,
): Promise<GenerateResult> {
  const plan = await buildDayPlan(locale, dayIso);
  const { start } = dayBounds(dayIso);

  const legById = new Map(plan.legs.map((l) => [l.id, l]));
  const existing = await db.trip.findMany({
    where: { date: start, legKey: { not: null } },
    select: { id: true, legKey: true, status: true },
  });
  const byKey = new Map(existing.map((t) => [t.legKey!, t]));

  let created = 0;
  let refreshed = 0;
  let locked = 0;

  for (const a of plan.assignments) {
    const leg = legById.get(a.legId);
    if (!leg) continue;

    const key = legKeyFor({
      passengerKind: leg.passengerKind,
      passengerId: leg.passengerId,
      fromSessionId: leg.fromSessionId,
      toSessionId: leg.toSessionId,
    });
    const prior = byKey.get(key);
    if (prior && !generatorMayReplace(prior.status as TripStatus)) {
      locked++;
      continue;
    }

    const driver = plan.drivers.find((d) => d.id === a.driverId) ?? null;
    const rideKm = distanceKm(leg.from, leg.to);
    const data = {
      date: start,
      status: "PROPOSED",
      legKey: key,
      driverId: a.driverId,
      vehicleId: driver?.vehicleId ?? null,
      plannedStartMin: a.departMin,
      plannedEndMin: a.dropoffMin,
      estimatedKm: Math.round((rideKm + a.deadheadKm) * 100) / 100,
      estimatedMin: a.dropoffMin - a.departMin,
      autoAllocated: true,
      allocationScore: a.score,
      deadheadKm: a.deadheadKm,
      slackMin: a.slackMin,
      createdById: byUserId ?? null,
    };

    const stops = [
      {
        seq: 1,
        kind: "PICKUP",
        lat: leg.from.lat,
        lng: leg.from.lng,
        label: leg.fromLabel,
        plannedMin: a.pickupMin,
        passengerTeacherId: leg.passengerKind === "TEACHER" ? leg.passengerId : null,
        passengerStudentId: leg.passengerKind === "STUDENT" ? leg.passengerId : null,
        sessionId: leg.fromSessionId,
      },
      {
        seq: 2,
        kind: "DROPOFF",
        lat: leg.to.lat,
        lng: leg.to.lng,
        label: leg.toLabel,
        plannedMin: a.dropoffMin,
        passengerTeacherId: leg.passengerKind === "TEACHER" ? leg.passengerId : null,
        passengerStudentId: leg.passengerKind === "STUDENT" ? leg.passengerId : null,
        sessionId: leg.toSessionId,
      },
    ];

    if (prior) {
      // Replace the stops wholesale: the ride may have moved with its lesson.
      await db.tripStop.deleteMany({ where: { tripId: prior.id } });
      await db.trip.update({
        where: { id: prior.id },
        data: { ...data, stops: { create: stops } },
      });
      refreshed++;
    } else {
      await db.trip.create({ data: { ...data, stops: { create: stops } } });
      created++;
    }
  }

  return {
    created,
    refreshed,
    locked,
    unassigned: plan.unassigned.length,
  };
}

export type BoardTrip = {
  id: string;
  status: TripStatus;
  legKey: string | null;
  driverId: string | null;
  driverName: string | null;
  plate: string | null;
  plannedStartMin: number;
  plannedEndMin: number;
  estimatedKm: number;
  estimatedMin: number;
  deadheadKm: number | null;
  slackMin: number | null;
  autoAllocated: boolean;
  passengerName: string | null;
  fromLabel: string;
  toLabel: string;
  stops: { seq: number; kind: string; label: string; plannedMin: number; lat: number; lng: number }[];
};

/** Read the day's trips for the board / register. */
export async function loadDayTrips(locale: string, dayIso: string): Promise<BoardTrip[]> {
  const { start } = dayBounds(dayIso);
  const trips = await db.trip.findMany({
    where: { date: start },
    include: {
      driver: { include: { employee: true } },
      vehicle: true,
      stops: {
        orderBy: { seq: "asc" },
        include: { passengerTeacher: true, passengerStudent: true },
      },
    },
    orderBy: [{ plannedStartMin: "asc" }, { id: "asc" }],
  });

  return trips.map((t) => {
    const first = t.stops[0];
    const last = t.stops[t.stops.length - 1];
    const passenger =
      first?.passengerTeacher ?? first?.passengerStudent ?? null;
    return {
      id: t.id,
      status: t.status as TripStatus,
      legKey: t.legKey,
      driverId: t.driverId,
      driverName: t.driver ? displayName(t.driver.employee, locale) : null,
      plate: t.vehicle?.plate ?? null,
      plannedStartMin: t.plannedStartMin,
      plannedEndMin: t.plannedEndMin,
      estimatedKm: toNumber(t.estimatedKm),
      estimatedMin: t.estimatedMin,
      deadheadKm: t.deadheadKm == null ? null : toNumber(t.deadheadKm),
      slackMin: t.slackMin,
      autoAllocated: t.autoAllocated,
      passengerName: passenger ? displayName(passenger, locale) : null,
      fromLabel: first?.label ?? "",
      toLabel: last?.label ?? "",
      stops: t.stops.map((s) => ({
        seq: s.seq,
        kind: s.kind,
        label: s.label,
        plannedMin: s.plannedMin,
        lat: s.lat,
        lng: s.lng,
      })),
    };
  });
}

/** Estimated travel minutes between two points under the current profile. */
export function estimateMinutes(
  config: TransportConfig,
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  departMin: number,
): number {
  return travelMinutes(distanceKm(a, b), departMin, config.profile);
}
