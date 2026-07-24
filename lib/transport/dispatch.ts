import "server-only";
import { buildDayPlan, loadDayTrips, type BoardTrip, type DayPlan } from "./trip-data";

/**
 * The dispatch cockpit's data (the "المخطط اليومي للنقل" board).
 *
 * Pure composition of what the engine already produces — buildDayPlan (legs,
 * drivers, unassigned) + loadDayTrips (the persisted, validated trips). No new
 * computation of truth here: the board just re-lays-out driver lanes, the
 * unassigned pool and the day's totals. Editing (assign/preview) lives in the
 * server actions, not here.
 */

export type LaneTrip = {
  id: string;
  tripKind: string | null;
  validationStatus: string;
  status: string;
  passengerName: string | null;
  passengerCount: number;
  plannedStartMin: number;
  plannedEndMin: number;
  estimatedKm: number;
  fallbackUsed: boolean;
  routeGeometry: string | null;
  stops: { seq: number; kind: string; label: string; plannedMin: number; lat: number; lng: number }[];
};

export type DriverLane = {
  driverId: string;
  driverName: string;
  plate: string | null;
  capacity: number;
  shiftStartMin: number | null;
  shiftEndMin: number | null;
  trips: LaneTrip[];
};

export type PoolItem = {
  /** `TEACHER:id` / `STUDENT:id` — the key an assign action takes. */
  passengerKey: string;
  passengerKind: string;
  passengerName: string;
  /** Earliest lesson the day hinges on (minutes from midnight), for urgency. */
  needByMin: number | null;
  /** Why it is not on a lane: an allocator reason, or "not yet planned". */
  reason: string;
};

export type DispatchStats = {
  totalTrips: number;
  unassigned: number;
  /** Planned-infeasible trips — the v1 meaning of "late" (spec decision). */
  blocked: number;
  warning: number;
  valid: number;
  /** Lifecycle. */
  completed: number;
  remaining: number;
  stops: { total: number; homes: number; centre: number; toCentre: number; fromCentre: number };
};

export type DispatchBoard = {
  day: string;
  centreSet: boolean;
  /** Centre coordinates for the map, or null when unset. */
  centre: { lat: number; lng: number } | null;
  lanes: DriverLane[];
  pool: PoolItem[];
  stats: DispatchStats;
  /** Timeline extent across every trip stop (minutes from midnight). */
  axis: { minMin: number; maxMin: number };
};

const LIFECYCLE_DONE = new Set(["COMPLETED"]);
const LIFECYCLE_DEAD = new Set(["CANCELLED"]);

function nearCentre(
  p: { lat: number; lng: number },
  centre: { lat: number; lng: number } | null,
): boolean {
  return (
    centre != null &&
    Math.abs(p.lat - centre.lat) < 0.0005 &&
    Math.abs(p.lng - centre.lng) < 0.0005
  );
}

export async function dispatchBoard(locale: string, day: string): Promise<DispatchBoard> {
  const [plan, trips]: [DayPlan, BoardTrip[]] = await Promise.all([
    buildDayPlan(locale, day),
    loadDayTrips(locale, day),
  ]);
  const centre = plan.config.centre;

  // Live (non-cancelled) trips make up the lanes and the totals.
  const liveTrips = trips.filter((t) => !LIFECYCLE_DEAD.has(t.status));

  // --- driver lanes -------------------------------------------------------
  const laneByDriver = new Map<string, DriverLane>();
  for (const d of plan.drivers) {
    laneByDriver.set(d.id, {
      driverId: d.id,
      driverName: d.name,
      plate: d.plate,
      capacity: d.capacity,
      shiftStartMin: d.shiftStartMin,
      shiftEndMin: d.shiftEndMin,
      trips: [],
    });
  }
  for (const t of liveTrips) {
    if (!t.driverId) continue;
    const lane = laneByDriver.get(t.driverId);
    if (!lane) continue;
    lane.trips.push({
      id: t.id,
      tripKind: t.tripKind,
      validationStatus: t.validationStatus,
      status: t.status,
      passengerName: t.passengerName,
      passengerCount: t.passengerCount,
      plannedStartMin: t.plannedStartMin,
      plannedEndMin: t.plannedEndMin,
      estimatedKm: t.estimatedKm,
      fallbackUsed: t.fallbackUsed,
      routeGeometry: t.routeGeometry,
      stops: t.stops.map((s) => ({ seq: s.seq, kind: s.kind, label: s.label, plannedMin: s.plannedMin, lat: s.lat, lng: s.lng })),
    });
  }
  for (const lane of laneByDriver.values()) {
    lane.trips.sort((a, b) => a.plannedStartMin - b.plannedStartMin);
  }
  const lanes = [...laneByDriver.values()].sort((a, b) =>
    a.driverName.localeCompare(b.driverName, locale),
  );

  // --- unassigned pool ----------------------------------------------------
  // A passenger belongs in the pool when they have legs today but no live trip.
  // A passenger "has a trip" when a live trip's linkGroup (`day:KIND:id`) names
  // them — the same key an assign action takes.
  const trippedKeys = new Set<string>();
  for (const t of liveTrips) {
    if (t.linkGroup) {
      // linkGroup = `day:KIND:id`
      const m = /^day:(TEACHER|STUDENT):(.+)$/.exec(t.linkGroup);
      if (m) trippedKeys.add(`${m[1]}:${m[2]}`);
    }
  }
  const legReason = new Map<string, string>();
  for (const u of plan.unassigned) {
    const leg = plan.legs.find((l) => l.id === u.legId);
    if (leg) legReason.set(`${leg.passengerKind}:${leg.passengerId}`, u.reason);
  }
  const poolAgg = new Map<string, PoolItem>();
  for (const leg of plan.legs) {
    const key = `${leg.passengerKind}:${leg.passengerId}`;
    if (trippedKeys.has(key)) continue;
    const existing = poolAgg.get(key);
    const need = leg.dueMin;
    if (existing) {
      existing.needByMin =
        existing.needByMin == null ? need : Math.min(existing.needByMin, need);
    } else {
      poolAgg.set(key, {
        passengerKey: key,
        passengerKind: leg.passengerKind,
        passengerName: leg.passengerName,
        needByMin: need,
        reason: legReason.get(key) ?? "notPlanned",
      });
    }
  }
  const pool = [...poolAgg.values()].sort(
    (a, b) => (a.needByMin ?? 1e9) - (b.needByMin ?? 1e9),
  );

  // --- stats --------------------------------------------------------------
  let blocked = 0;
  let warning = 0;
  let valid = 0;
  let completed = 0;
  let remaining = 0;
  let stopsTotal = 0;
  let stopsHome = 0;
  let stopsCentre = 0;
  let toCentre = 0;
  let fromCentre = 0;
  let minMin = Number.POSITIVE_INFINITY;
  let maxMin = Number.NEGATIVE_INFINITY;
  for (const t of liveTrips) {
    if (t.validationStatus === "INVALID") blocked++;
    else if (t.validationStatus === "WARNING") warning++;
    else valid++;
    if (LIFECYCLE_DONE.has(t.status)) completed++;
    else remaining++;
    if (t.tripKind === "PICKUP") toCentre++;
    else if (t.tripKind === "RETURN") fromCentre++;
    for (const s of t.stops) {
      stopsTotal++;
      if (nearCentre(s, centre)) stopsCentre++;
      else stopsHome++;
      if (s.plannedMin < minMin) minMin = s.plannedMin;
      if (s.plannedMin > maxMin) maxMin = s.plannedMin;
    }
  }
  if (!Number.isFinite(minMin)) {
    minMin = 8 * 60;
    maxMin = 20 * 60;
  }

  return {
    day,
    centreSet: plan.centreSet,
    centre,
    lanes,
    pool,
    stats: {
      totalTrips: liveTrips.length,
      unassigned: pool.length,
      blocked,
      warning,
      valid,
      completed,
      remaining,
      stops: { total: stopsTotal, homes: stopsHome, centre: stopsCentre, toCentre, fromCentre },
    },
    axis: { minMin, maxMin },
  };
}
