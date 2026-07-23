// Travel-time estimation for the transport module.
//
// Pure module — no imports, no `server-only` — because this is the number every
// driver allocation is decided on, and it must be unit-testable.
//
// Deliberately NOT a routing service. Home coordinates of students and teachers
// never leave the server: we estimate from straight-line distance × a road
// detour factor ÷ the speed in force at the departure minute. Accuracy is
// roughly ±20%, which is ample for choosing between drivers and for warning
// that a teacher cannot make the next lesson — and useless for promising a
// parent an exact arrival minute, so callers must present it as approximate.
//
// This whole file is the seam: swapping in OSRM later means reimplementing
// `travelMinutes`/`roadKm` and nothing else.
//
// All times are minutes from midnight, matching lib/planner.ts.

export type SpeedProfile = {
  /** Normal average speed, km/h. */
  baseKmh: number;
  /** Average speed inside a rush window, km/h. */
  rushKmh: number;
  /** Rush windows as [startMin, endMin) pairs, minutes from midnight. */
  rushWindows: [number, number][];
  /** Straight line → road distance multiplier (1.35 ≈ typical urban grid). */
  detourFactor: number;
  /** Floor for any journey: parking, walking to the car, handover. */
  minMinutes: number;
};

export const DEFAULT_SPEED_PROFILE: SpeedProfile = {
  baseKmh: 40,
  rushKmh: 25,
  rushWindows: [
    [7 * 60, 9 * 60],
    [16 * 60, 19 * 60],
  ],
  detourFactor: 1.35,
  minMinutes: 5,
};

/** Is this minute inside a rush window? Windows are half-open: [start, end). */
export function isRushMinute(min: number, p: SpeedProfile): boolean {
  return p.rushWindows.some(([from, to]) => min >= from && min < to);
}

/** Speed in force at a departure minute, km/h. */
export function speedAt(min: number, p: SpeedProfile): number {
  const kmh = isRushMinute(min, p) ? p.rushKmh : p.baseKmh;
  // A zero/negative speed would divide by zero downstream; refuse it.
  return kmh > 0 ? kmh : 1;
}

/** Straight-line km → estimated road km. */
export function roadKm(straightKm: number, p: SpeedProfile): number {
  if (!Number.isFinite(straightKm) || straightKm <= 0) return 0;
  return straightKm * p.detourFactor;
}

/**
 * Estimated journey time in whole minutes, floored at `minMinutes` — even a
 * next-door trip costs time. Rounded up: it is safer to over-reserve a driver
 * than to promise an arrival that misses the lesson.
 */
export function travelMinutes(
  straightKm: number,
  departMin: number,
  p: SpeedProfile,
): number {
  const km = roadKm(straightKm, p);
  const minutes = (km / speedAt(departMin, p)) * 60;
  return Math.max(p.minMinutes, Math.ceil(minutes));
}

/**
 * Parse the `transportRushWindows` setting: "07:00-09:00,16:00-19:00".
 * Malformed entries are skipped rather than throwing — a typo in settings must
 * not take the allocator down; it just costs the rush-hour slowdown.
 */
export function parseRushWindows(raw: string | null | undefined): [number, number][] {
  if (!raw) return [];
  const out: [number, number][] = [];
  for (const part of raw.split(",")) {
    const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(part);
    if (!m) continue;
    const from = Number(m[1]) * 60 + Number(m[2]);
    const to = Number(m[3]) * 60 + Number(m[4]);
    if (from >= 0 && to > from && to <= 24 * 60) out.push([from, to]);
  }
  return out;
}
