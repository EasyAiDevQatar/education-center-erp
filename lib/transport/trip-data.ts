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
import {
  validateTrip,
  turnaroundFeasible,
  coordValid,
  arrivalWindow,
  departureFloor,
  type StopForValidation,
  type ValidationMessage,
} from "./validate";
import { getMatrixWithFallback, getFallbackProvider, getRoutingProvider } from "./routing";
import { segmentByCentre } from "./segment";
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
  /** sessionId → {startMin,endMin}, for validation of the persisted trips. */
  sessionWindows?: Map<string, { startMin: number; endMin: number }>;
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
  const wantTeachers = config.include.teacher;
  const wantStudents = config.include.studentToCenter || config.include.studentToHome;

  /** Where a lesson physically happens. */
  const placeOf = (s: (typeof sessions)[number]) =>
    s.location === "HOME"
      ? s.student.homeLat != null && s.student.homeLng != null
        ? { at: { lat: s.student.homeLat, lng: s.student.homeLng }, label: s.student.homeCode ?? displayName(s.student, locale) }
        : { at: null, label: displayName(s.student, locale) }
      : { at: centre, label: centreLabel };

  const minutesOf = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

  // Session time windows the validator checks arrivals/departures against.
  const sessionWindows = new Map<string, { startMin: number; endMin: number }>();
  for (const x of sessions) {
    sessionWindows.set(x.id, {
      startMin: minutesOf(x.date),
      endMin: minutesOf(x.date) + Math.round(toNumber(x.hours) * 60),
    });
  }

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
  const built = buildDayLegs(chainDays, {
    arriveEarlyMin: config.bufferMin,
  });
  // Student direction toggles: a leg arriving at the centre is a to-center
  // pickup; a leg leaving the centre is a to-home return. Teacher legs are
  // unaffected. ~50 m tolerance around the centre pin.
  const nearCentre = (p: { lat: number; lng: number } | null) =>
    p != null && centre != null &&
    Math.abs(p.lat - centre.lat) < 0.0005 && Math.abs(p.lng - centre.lng) < 0.0005;
  const legs = built.legs.filter((l) => {
    if (l.passengerKind !== "STUDENT") return true;
    if (nearCentre(l.to)) return config.include.studentToCenter;
    if (nearCentre(l.from)) return config.include.studentToHome;
    return true;
  });
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
    sessionWindows,
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

  // Rebuild the generator's own proposals for each passenger as one or more
  // direction-coherent trips (توصيل to the centre, عودة from it — see the
  // segmentation below). Trips a human has touched are left alone.
  const priorTrips = await db.trip.findMany({
    where: { date: start },
    select: { id: true, status: true, legKey: true },
  });
  // A passenger's day may now be several linked trips (legKey `day:pkey:idx`).
  // If ANY of them is locked, the whole passenger is left alone so we never
  // rebuild half a linked pair. Match on the shared base key.
  const baseOf = (legKey: string | null) => (legKey ?? "").replace(/:\d+$/, "");
  const lockedKeys = new Set(
    priorTrips
      .filter((t) => !generatorMayReplace(t.status as TripStatus))
      .map((t) => baseOf(t.legKey)),
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

  // Trips created this run, kept for the cross-trip turnaround pass (spec §20).
  type CreatedTrip = {
    id: string;
    driverId: string;
    vehicleId: string | null;
    plannedStartMin: number;
    plannedEndMin: number;
    firstPt: { lat: number; lng: number } | null;
    lastPt: { lat: number; lng: number } | null;
    validationStatus: string;
    validationMessages: ValidationMessage[];
  };
  const createdTrips: CreatedTrip[] = [];

  for (const [pkey, items] of byPassenger) {
    const baseLegKey = `day:${pkey}`;
    if (lockedKeys.has(baseLegKey)) {
      locked++;
      continue;
    }
    items.sort(
      (x, y) => x.leg.readyMin - y.leg.readyMin || x.leg.id.localeCompare(y.leg.id),
    );
    const assigned = items.filter((x) => x.a);
    if (assigned.length === 0) continue; // whole chain infeasible → stays in problems

    const pkind = items[0].leg.passengerKind;
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
    let deadhead = 0;
    for (const { leg, a } of items) {
      wps.push({ pt: leg.from, kind: "PICKUP", label: leg.fromLabel, plannedMin: a?.pickupMin ?? leg.readyMin, sessionId: leg.fromSessionId });
      wps.push({ pt: leg.to, kind: "DROPOFF", label: leg.toLabel, plannedMin: a?.dropoffMin ?? leg.dueMin, sessionId: leg.toSessionId });
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

    // Split the day at the centre (C4): a run of stops ending at the centre is a
    // delivery (توصيل / PICKUP), one leaving it is a return (عودة / RETURN). Each
    // segment becomes its own linked trip, validated on its own — so a return's
    // loose end-of-day home deadline never flatters a delivery's tight one.
    const segments = segmentByCentre(merged, (w) => w.pt, plan.config.centre);
    const win = plan.sessionWindows;
    const rules = plan.config.rules;
    const op = plan.config.operational;
    const serviceSecFor = (k: string) =>
      Math.round((k === "PICKUP" ? op.boardingTimeMin : op.dropoffTimeMin) * 60);

    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      const seg = segments[segIdx];
      if (seg.items.length < 2) continue;

      // Number distinct locations L1, L2, … within THIS trip.
      const locNum = new Map<string, number>();
      const stops = seg.items.map((wp, idx) => {
        const ck = `${wp.pt.lat.toFixed(4)},${wp.pt.lng.toFixed(4)}`;
        if (!locNum.has(ck)) locNum.set(ck, locNum.size + 1);
        return {
          seq: idx + 1,
          kind: wp.kind,
          lat: wp.pt.lat,
          lng: wp.pt.lng,
          label: `L${locNum.get(ck)} · ${wp.label}`,
          plannedMin: wp.plannedMin,
          passengerTeacherId: pkind === "TEACHER" ? passengerId : null,
          passengerStudentId: pkind === "STUDENT" ? passengerId : null,
          sessionId: wp.sessionId,
        };
      });

      const plannedStartMin = stops[0].plannedMin;
      const plannedEndMin = stops[stops.length - 1].plannedMin;

      // Real road duration/distance for this trip's stops (OSRM when up, the
      // marked estimator otherwise). A bad pin forces the estimator rather than
      // a nonsense (0,0) road time.
      const points = stops.map((st) => ({ lat: st.lat, lng: st.lng }));
      const allCoordsValid = points.every((p) => coordValid(p.lat, p.lng));
      const matrix = allCoordsValid
        ? await getMatrixWithFallback(points)
        : await getFallbackProvider().getMatrix(points);

      let realDistM = 0;
      const breakdown = stops.map((st, i) => {
        const service = serviceSecFor(st.kind);
        if (i === 0) {
          return { routingDurationS: null as number | null, serviceDurationS: service, delayAllowanceS: 0, operationalDurationS: null as number | null, distanceFromPrevM: null as number | null };
        }
        const rawDur = matrix.durationsSeconds[i - 1]?.[i] ?? null;
        const rawDist = matrix.distancesMeters[i - 1]?.[i] ?? null;
        const fixedDelay = Math.round(op.fixedDelayMin * 60);
        const traffic = rawDur == null ? 0 : Math.round((rawDur * op.trafficBufferPercent) / 100);
        const delayAllowanceS = fixedDelay + traffic;
        const operationalDurationS = rawDur == null ? null : rawDur + delayAllowanceS + service;
        if (rawDist != null) realDistM += rawDist;
        return { routingDurationS: rawDur, serviceDurationS: service, delayAllowanceS, operationalDurationS, distanceFromPrevM: rawDist };
      });

      const vStops: StopForValidation[] = stops.map((st, i) => {
        const w = st.sessionId ? win?.get(st.sessionId) : undefined;
        return {
          seq: st.seq,
          kind: st.kind,
          plannedMin: st.plannedMin,
          sessionStartMin: w?.startMin ?? null,
          sessionEndMin: w?.endMin ?? null,
          servesSession: st.sessionId != null,
          fallbackUsed: matrix.fallbackUsed,
          roadTravelFromPrevS: breakdown[i].routingDurationS,
        };
      });
      const v = validateTrip(vStops, rules);

      const stopsCreate = stops.map((st, i) => ({
        ...st,
        routingDurationS: breakdown[i].routingDurationS,
        serviceDurationS: breakdown[i].serviceDurationS,
        delayAllowanceS: breakdown[i].delayAllowanceS,
        operationalDurationS: breakdown[i].operationalDurationS,
        distanceFromPrevM: breakdown[i].distanceFromPrevM,
        estimated: matrix.estimated,
        fallbackUsed: matrix.fallbackUsed,
      }));

      const km = realDistM > 0 ? realDistM / 1000 : 0;

      // Tightest margin against THIS trip's own binding constraint (C3/C4):
      // arrival latitude for a delivery, ready-to-leave slack for a return. A
      // return's loose home deadline never inflates a delivery's margin.
      let slackMin: number | null = null;
      for (const st of stops) {
        if (!st.sessionId) continue;
        const w = win?.get(st.sessionId);
        if (!w) continue;
        const margin =
          st.kind === "DROPOFF"
            ? arrivalWindow(w.startMin, rules).latest - st.plannedMin
            : st.plannedMin - departureFloor(w.endMin, rules);
        slackMin = slackMin == null ? margin : Math.min(slackMin, margin);
      }

      // Real road geometry (OSRM polyline) for the board; null on the estimator.
      let routeGeometry: string | null = null;
      if (!matrix.fallbackUsed && allCoordsValid && points.length > 1) {
        try {
          routeGeometry = (await getRoutingProvider().getRouteThroughStops(points)).geometry;
        } catch {
          routeGeometry = null;
        }
      }

      const trip = await db.trip.create({
        data: {
          date: start,
          status: "PROPOSED",
          legKey: `${baseLegKey}:${segIdx}`,
          tripKind: seg.kind,
          linkGroup: baseLegKey,
          validationStatus: v.status,
          validationMessages: JSON.stringify(v.messages),
          driverId,
          vehicleId: driver?.vehicleId ?? null,
          plannedStartMin,
          plannedEndMin,
          estimatedKm: Math.round(km * 100) / 100,
          estimatedMin: plannedEndMin - plannedStartMin,
          autoAllocated: true,
          allocationScore: assigned[0].a!.score,
          // Empty km to reach the first pickup belongs to the delivery leg only.
          deadheadKm: segIdx === 0 ? Math.round(deadhead * 100) / 100 : 0,
          slackMin,
          routeGeometry,
          createdById: byUserId ?? null,
          stops: { create: stopsCreate },
        },
        select: { id: true },
      });
      createdTrips.push({
        id: trip.id,
        driverId,
        vehicleId: driver?.vehicleId ?? null,
        plannedStartMin,
        plannedEndMin,
        firstPt: { lat: stops[0].lat, lng: stops[0].lng },
        lastPt: { lat: stops[stops.length - 1].lat, lng: stops[stops.length - 1].lng },
        validationStatus: v.status,
        validationMessages: v.messages,
      });
      created++;
    }
  }

  // --- turnaround: can each driver/vehicle actually get from one of its trips
  // to the next in time (spec §20)? Deadhead between trips uses the straight-line
  // estimator (a coarse gate); a violation downgrades the later trip to INVALID
  // with the offending gap so it cannot be approved without an override.
  const rules = plan.config.rules;
  const extra = new Map<string, ValidationMessage[]>();
  const checkResource = (
    keyOf: (t: CreatedTrip) => string | null,
    minTurn: number,
    label: string,
  ) => {
    const groups = new Map<string, CreatedTrip[]>();
    for (const t of createdTrips) {
      const k = keyOf(t);
      if (!k) continue;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
    }
    for (const trips of groups.values()) {
      trips.sort((a, b) => a.plannedStartMin - b.plannedStartMin);
      for (let i = 1; i < trips.length; i++) {
        const prev = trips[i - 1];
        const next = trips[i];
        const deadheadMin =
          prev.lastPt && next.firstPt
            ? travelMinutes(distanceKm(prev.lastPt, next.firstPt), prev.plannedEndMin, plan.config.profile)
            : 0;
        if (!turnaroundFeasible(prev.plannedEndMin, next.plannedStartMin, deadheadMin, minTurn, rules)) {
          const gap = next.plannedStartMin - prev.plannedEndMin;
          const list = extra.get(next.id) ?? [];
          list.push({
            code: "TURNAROUND_TIME_INSUFFICIENT",
            level: "INVALID",
            text: `${label}: only ${gap} min before this trip, but the previous one needs ${deadheadMin} min to reach it plus turnaround.`,
          });
          extra.set(next.id, list);
        }
      }
    }
  };
  checkResource((t) => t.driverId, rules.minDriverTurnaroundMin, "Driver turnaround");
  checkResource((t) => t.vehicleId, rules.minVehicleTurnaroundMin, "Vehicle turnaround");

  for (const [id, msgs] of extra) {
    const t = createdTrips.find((x) => x.id === id)!;
    const merged = [...t.validationMessages, ...msgs];
    await db.trip.update({
      where: { id },
      data: { validationStatus: "INVALID", validationMessages: JSON.stringify(merged) },
    });
  }

  return {
    created,
    refreshed,
    locked,
    unassigned: plan.unassigned.length,
  };
}

/** Labelled per-passenger timing for a stop that serves a lesson (spec §27-28).
 *  Direction decides which set of fields is meaningful: a delivery to the lesson
 *  is judged on arrival, a collection after the lesson on departure. */
export type StopTiming =
  | {
      dir: "TO_LESSON";
      sessionStartMin: number;
      sessionEndMin: number;
      /** Preferred arrival = lesson start − preferred buffer. */
      requiredArrivalMin: number;
      /** Latest allowed = lesson start − min buffer. */
      latestArrivalMin: number;
      plannedArrivalMin: number;
      /** Minutes past the required arrival (>0 = late); else 0. */
      delayMin: number;
      /** Minutes of comfort before required arrival (>0 = early); else 0. */
      marginMin: number;
    }
  | {
      dir: "FROM_LESSON";
      sessionStartMin: number;
      sessionEndMin: number;
      /** Ready to leave = lesson end + dismissal buffer. */
      readyFromMin: number;
      plannedDepartMin: number;
      /** Minutes waiting after ready (>0); else 0. */
      waitMin: number;
      /** Minutes it leaves before the passenger is ready (>0 = invalid); else 0. */
      earlyDepartMin: number;
    };

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
  /** Distinct passengers served (for the card header). */
  passengerCount: number;
  /** Direction after the C4 split: PICKUP | RETURN | CHAIN | null. */
  tripKind: string | null;
  /** Shared key grouping a passenger's linked توصيل + عودة trips. */
  linkGroup: string | null;
  fromLabel: string;
  toLabel: string;
  /** Phase-1/2 validation surfaced to the board. */
  validationStatus: string;
  validationMessages: { code: string; level: string; stopSeq?: number; text: string }[];
  /** True when any leg fell back to the straight-line estimate (spec §14, §28). */
  fallbackUsed: boolean;
  /** OSRM encoded polyline for the whole route, or null (draw straight lines). */
  routeGeometry: string | null;
  stops: {
    id: string;
    seq: number;
    kind: string;
    label: string;
    plannedMin: number;
    lat: number;
    lng: number;
    sessionStartMin: number | null;
    sessionEndMin: number | null;
    estimated: boolean;
    fallbackUsed: boolean;
    routingDurationS: number | null;
    operationalDurationS: number | null;
    /** Passenger this stop serves (for per-passenger reasons/labels). */
    passengerName: string | null;
    /** Labelled timing when this stop serves a lesson; null otherwise. */
    timing: StopTiming | null;
  }[];
};

/** Read the day's trips for the board / register. */
export async function loadDayTrips(locale: string, dayIso: string): Promise<BoardTrip[]> {
  const { start } = dayBounds(dayIso);
  // Timing labels are derived against the same rules the validator used, so the
  // card and the verdict never disagree.
  const config = await loadTransportConfig();
  const r = config.rules;

  /** Build the labelled timing for a session-serving stop (spec §27-28). */
  const stopTiming = (
    kind: string,
    plannedMin: number,
    sessionStartMin: number | null,
    sessionEndMin: number | null,
  ): StopTiming | null => {
    if (kind === "DROPOFF" && sessionStartMin != null) {
      const w = arrivalWindow(sessionStartMin, r);
      const diff = plannedMin - w.preferred;
      return {
        dir: "TO_LESSON",
        sessionStartMin,
        sessionEndMin: sessionEndMin ?? sessionStartMin,
        requiredArrivalMin: w.preferred,
        latestArrivalMin: w.latest,
        plannedArrivalMin: plannedMin,
        delayMin: Math.max(0, diff),
        marginMin: Math.max(0, -diff),
      };
    }
    if (kind === "PICKUP" && sessionEndMin != null) {
      const readyFrom = departureFloor(sessionEndMin, r);
      const diff = plannedMin - readyFrom;
      return {
        dir: "FROM_LESSON",
        sessionStartMin: sessionStartMin ?? sessionEndMin,
        sessionEndMin,
        readyFromMin: readyFrom,
        plannedDepartMin: plannedMin,
        waitMin: Math.max(0, diff),
        earlyDepartMin: Math.max(0, -diff),
      };
    }
    return null;
  };

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
    const passengerIds = new Set(
      t.stops
        .map((s) => s.passengerTeacherId ?? s.passengerStudentId)
        .filter((x): x is string => x != null),
    );
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
      passengerCount: passengerIds.size,
      tripKind: t.tripKind ?? null,
      linkGroup: t.linkGroup ?? null,
      fromLabel: first?.label ?? "",
      toLabel: last?.label ?? "",
      validationStatus: t.validationStatus,
      validationMessages: t.validationMessages
        ? (() => {
            try {
              return JSON.parse(t.validationMessages) as BoardTrip["validationMessages"];
            } catch {
              return [];
            }
          })()
        : [],
      fallbackUsed: t.stops.some((s) => s.fallbackUsed),
      routeGeometry: t.routeGeometry ?? null,
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
        estimated: s.estimated,
        fallbackUsed: s.fallbackUsed,
        routingDurationS: s.routingDurationS,
        operationalDurationS: s.operationalDurationS,
        passengerName: (s.passengerTeacher ?? s.passengerStudent)
          ? displayName((s.passengerTeacher ?? s.passengerStudent)!, locale)
          : null,
        timing: stopTiming(
          s.kind,
          s.plannedMin,
          sMin,
          sMin != null && sess ? sMin + Math.round(toNumber(sess.hours) * 60) : null,
        ),
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

/**
 * A session's timing/location changed (or it was cancelled). Flag its still-open
 * trips for review rather than silently mutating an approved plan (spec §23).
 * COMPLETED/CANCELLED/STARTED trips are left alone — they are history or already
 * on the road.
 */
export async function flagTripsForSession(sessionId: string, reason: string): Promise<number> {
  const stops = await db.tripStop.findMany({
    where: { sessionId },
    select: { tripId: true },
  });
  const tripIds = [...new Set(stops.map((s) => s.tripId))];
  if (tripIds.length === 0) return 0;

  const affected = await db.trip.findMany({
    where: { id: { in: tripIds }, status: { in: ["PROPOSED", "ASSIGNED", "PLANNED"] } },
    select: { id: true, status: true },
  });
  for (const t of affected) {
    await db.trip.update({
      where: { id: t.id },
      data: {
        status: "NEEDS_REVIEW",
        needsReviewReason: reason,
        // Dropping approval — the override, if any, no longer applies.
        approvedById: null,
        approvedAt: null,
      },
    });
    await db.tripEvent.create({
      data: { tripId: t.id, fromStatus: t.status, toStatus: "NEEDS_REVIEW", note: reason },
    });
  }
  return affected.length;
}
