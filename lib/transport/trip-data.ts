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
  // Who genuinely needs a driver (see the chain filter below).
  const teacherHasHome = new Set<string>();
  const studentHasCenter = new Set<string>();

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
      if (s.location === "HOME") teacherHasHome.add(key);
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
      if (s.location === "CENTER") studentHasCenter.add(key);
    }
  }

  // Who actually needs a driver: a teacher who teaches at a home that day (they
  // travel there and back, through the centre for any centre lessons in
  // between), or a student who must reach the centre. Everyone else gets
  // themselves about — so the board mirrors the day's home visits rather than
  // filling with self-commutes. The FULL day is kept for those who qualify, so
  // every trip chains inward/outward across sessions, the centre and home.
  const chainDays = [...days.values()].filter((d) =>
    d.passengerKind === "TEACHER"
      ? teacherHasHome.has(`TEACHER:${d.passengerId}`)
      : studentHasCenter.has(`STUDENT:${d.passengerId}`),
  );
  const { legs, skipped } = buildDayLegs(chainDays, {
    arriveEarlyMin: config.bufferMin,
  });

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

  // Rebuild the generator's own proposals as ONE chained trip per passenger:
  // their whole day — home → lesson → lesson → centre → … → home — as an
  // ordered run of numbered stops. Trips a human has touched are left alone.
  const priorTrips = await db.trip.findMany({
    where: { date: start },
    select: { id: true, status: true, legKey: true },
  });
  const lockedKeys = new Set(
    priorTrips
      .filter((t) => !generatorMayReplace(t.status as TripStatus))
      .map((t) => t.legKey),
  );
  const removable = priorTrips.filter((t) => generatorMayReplace(t.status as TripStatus));
  if (removable.length) {
    const ids = removable.map((t) => t.id);
    await db.tripStop.deleteMany({ where: { tripId: { in: ids } } });
    await db.trip.deleteMany({ where: { id: { in: ids } } });
  }

  const asgByLeg = new Map(plan.assignments.map((a) => [a.legId, a]));
  const byPassenger = new Map<string, { leg: Leg; a: Assignment | null }[]>();
  for (const leg of plan.legs) {
    const key = `${leg.passengerKind}:${leg.passengerId}`;
    if (!byPassenger.has(key)) byPassenger.set(key, []);
    byPassenger.get(key)!.push({ leg, a: asgByLeg.get(leg.id) ?? null });
  }

  const same = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
    Math.abs(a.lat - b.lat) < 0.0005 && Math.abs(a.lng - b.lng) < 0.0005;

  let created = 0;
  const refreshed = 0;
  let locked = 0;

  for (const [pkey, items] of byPassenger) {
    const legKey = `day:${pkey}`;
    if (lockedKeys.has(legKey)) {
      locked++;
      continue;
    }
    items.sort(
      (x, y) => x.leg.readyMin - y.leg.readyMin || x.leg.id.localeCompare(y.leg.id),
    );
    const assigned = items.filter((x) => x.a);
    if (assigned.length === 0) continue; // whole chain infeasible → stays in problems

    const kind = items[0].leg.passengerKind;
    const passengerId = items[0].leg.passengerId;
    const driverId = assigned[0].a!.driverId;
    const driver = plan.drivers.find((d) => d.id === driverId) ?? null;

    // Every leg contributes a pickup then a drop-off; collapse consecutive stops
    // at the same place (a lesson is arrive-then-leave, one physical stop).
    type WP = {
      pt: { lat: number; lng: number };
      kind: string;
      label: string;
      plannedMin: number;
      sessionId: string | null;
    };
    const wps: WP[] = [];
    let totalKm = 0;
    let deadhead = 0;
    for (const { leg, a } of items) {
      wps.push({ pt: leg.from, kind: "PICKUP", label: leg.fromLabel, plannedMin: a?.pickupMin ?? leg.readyMin, sessionId: leg.fromSessionId });
      wps.push({ pt: leg.to, kind: "DROPOFF", label: leg.toLabel, plannedMin: a?.dropoffMin ?? leg.dueMin, sessionId: leg.toSessionId });
      totalKm += distanceKm(leg.from, leg.to) + (a?.deadheadKm ?? 0);
      deadhead += a?.deadheadKm ?? 0;
    }
    wps.sort((x, y) => x.plannedMin - y.plannedMin);
    const merged: WP[] = [];
    for (const wp of wps) {
      const last = merged[merged.length - 1];
      if (last && same(last.pt, wp.pt)) {
        last.plannedMin = Math.max(last.plannedMin, wp.plannedMin);
        if (wp.sessionId && !last.sessionId) last.sessionId = wp.sessionId;
        continue;
      }
      merged.push({ ...wp });
    }
    // Number distinct locations L1, L2, … in visit order; a place revisited
    // (the centre, the teacher's own home) keeps its number.
    const locNum = new Map<string, number>();
    const stops = merged.map((wp, idx) => {
      const ck = `${wp.pt.lat.toFixed(4)},${wp.pt.lng.toFixed(4)}`;
      if (!locNum.has(ck)) locNum.set(ck, locNum.size + 1);
      return {
        seq: idx + 1,
        kind: wp.kind,
        lat: wp.pt.lat,
        lng: wp.pt.lng,
        label: `L${locNum.get(ck)} · ${wp.label}`,
        plannedMin: wp.plannedMin,
        passengerTeacherId: kind === "TEACHER" ? passengerId : null,
        passengerStudentId: kind === "STUDENT" ? passengerId : null,
        sessionId: wp.sessionId,
      };
    });

    const plannedStartMin = Math.min(assigned[0].a!.departMin, stops[0].plannedMin);
    const plannedEndMin = stops[stops.length - 1].plannedMin;
    await db.trip.create({
      data: {
        date: start,
        status: "PROPOSED",
        legKey,
        driverId,
        vehicleId: driver?.vehicleId ?? null,
        plannedStartMin,
        plannedEndMin,
        estimatedKm: Math.round(totalKm * 100) / 100,
        estimatedMin: plannedEndMin - plannedStartMin,
        autoAllocated: true,
        allocationScore: assigned[0].a!.score,
        deadheadKm: Math.round(deadhead * 100) / 100,
        slackMin: Math.min(...assigned.map((x) => x.a!.slackMin)),
        createdById: byUserId ?? null,
        stops: { create: stops },
      },
    });
    created++;
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
  stops: { id: string; seq: number; kind: string; label: string; plannedMin: number; lat: number; lng: number; sessionStartMin: number | null; sessionEndMin: number | null }[];
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
        include: {
          passengerTeacher: true,
          passengerStudent: true,
          session: { select: { date: true, hours: true } },
        },
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
      stops: t.stops.map((s) => {
        const sess = s.session;
        const sMin = sess ? sess.date.getUTCHours() * 60 + sess.date.getUTCMinutes() : null;
        return {
        id: s.id,
        seq: s.seq,
        kind: s.kind,
        label: s.label,
        plannedMin: s.plannedMin,
        lat: s.lat,
        lng: s.lng,
        sessionStartMin: sMin,
        sessionEndMin: sMin != null && sess ? sMin + Math.round(toNumber(sess.hours) * 60) : null,
      };
      }),
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
