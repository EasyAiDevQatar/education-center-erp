// Fleet cost and utilisation arithmetic.
//
// Pure module — no imports, no DB — because these are the numbers a manager
// makes decisions on, and every one of them has a way of being quietly wrong:
// a missing odometer reading, a divide by zero, a driver with no shift.
//
// The rule throughout: when the inputs cannot support a figure, return null
// rather than 0. A fuel economy of "0 km/L" reads as a catastrophe; "—" reads
// as "we didn't record the odometer", which is the truth.

export type FuelEntry = {
  date: string;
  litres: number;
  cost: number;
  odometerKm: number | null;
};

/**
 * Distance covered between the first and last fill that both recorded an
 * odometer, and the litres burned over that span.
 *
 * Deliberately excludes the FIRST fill's litres: that fuel was burned before
 * the first reading, so counting it understates economy. This is the standard
 * "full-to-full" method and the mistake most naive implementations make.
 */
export function fuelEconomy(entries: FuelEntry[]): {
  km: number;
  litres: number;
  kmPerLitre: number | null;
} {
  const withOdo = entries
    .filter((e) => e.odometerKm != null && Number.isFinite(e.odometerKm))
    .sort((a, b) => (a.odometerKm! - b.odometerKm!) || a.date.localeCompare(b.date));

  if (withOdo.length < 2) return { km: 0, litres: 0, kmPerLitre: null };

  const km = withOdo[withOdo.length - 1].odometerKm! - withOdo[0].odometerKm!;
  // Skip the first entry's litres — see above.
  const litres = withOdo.slice(1).reduce((a, e) => a + (e.litres || 0), 0);

  if (km <= 0 || litres <= 0) return { km: Math.max(0, km), litres, kmPerLitre: null };
  return { km, litres, kmPerLitre: round2(km / litres) };
}

/** Cost per kilometre. Null when no distance is known — never Infinity. */
export function costPerKm(totalCost: number, km: number): number | null {
  if (!Number.isFinite(km) || km <= 0) return null;
  return round2(totalCost / km);
}

/** Cost per trip. Null when nothing ran, so an idle day doesn't read as free. */
export function costPerTrip(totalCost: number, trips: number): number | null {
  if (!Number.isInteger(trips) || trips <= 0) return null;
  return round2(totalCost / trips);
}

export type TripSpan = {
  driverId: string | null;
  plannedStartMin: number;
  plannedEndMin: number;
  estimatedKm: number;
  status: string;
};

export type DriverUtilisation = {
  driverId: string;
  trips: number;
  busyMin: number;
  km: number;
  /** Busy minutes as a share of the shift, 0–1. Null without a usable shift. */
  utilisation: number | null;
};

/**
 * How hard each driver worked.
 *
 * Cancelled trips are excluded — planning something and calling it off is not
 * work done, and counting it would flatter the number. Utilisation is capped at
 * 1: overrunning a shift is a rostering problem, not 130% productivity.
 */
export function driverUtilisation(
  trips: TripSpan[],
  shifts: Record<string, { startMin: number | null; endMin: number | null }>,
): DriverUtilisation[] {
  const acc = new Map<string, { trips: number; busyMin: number; km: number }>();

  for (const t of trips) {
    if (!t.driverId) continue;
    if (t.status === "CANCELLED") continue;
    const cur = acc.get(t.driverId) ?? { trips: 0, busyMin: 0, km: 0 };
    cur.trips += 1;
    cur.busyMin += Math.max(0, t.plannedEndMin - t.plannedStartMin);
    cur.km += t.estimatedKm || 0;
    acc.set(t.driverId, cur);
  }

  return [...acc.entries()]
    .map(([driverId, v]) => {
      const shift = shifts[driverId];
      const span =
        shift && shift.startMin != null && shift.endMin != null && shift.endMin > shift.startMin
          ? shift.endMin - shift.startMin
          : null;
      return {
        driverId,
        trips: v.trips,
        busyMin: v.busyMin,
        km: round2(v.km),
        utilisation: span ? Math.min(1, round4(v.busyMin / span)) : null,
      };
    })
    .sort((a, b) => b.busyMin - a.busyMin || a.driverId.localeCompare(b.driverId));
}

export type ArrivalRecord = {
  plannedMin: number;
  /** Minutes from midnight the driver actually arrived; null if never stamped. */
  actualMin: number | null;
};

/**
 * Share of stops reached by their planned minute.
 *
 * Stops with no arrival stamp are excluded from BOTH sides rather than counted
 * as late: an unstamped stop usually means the driver forgot to tap, and
 * treating that as a service failure would make the metric measure app usage
 * instead of punctuality. The count of what was measured is returned so the
 * figure can be read honestly.
 */
export function onTimeRate(
  records: ArrivalRecord[],
  graceMin = 5,
): { measured: number; onTime: number; rate: number | null } {
  const stamped = records.filter((r) => r.actualMin != null);
  if (stamped.length === 0) return { measured: 0, onTime: 0, rate: null };
  const onTime = stamped.filter((r) => r.actualMin! <= r.plannedMin + graceMin).length;
  return { measured: stamped.length, onTime, rate: round4(onTime / stamped.length) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
