// Turn a day's sessions into the rides they imply.
//
// Pure module (no imports) — the rules here decide who needs collecting and
// when, so they are unit-tested rather than discovered in production.
//
// A teacher's day is a sequence of places: home → first lesson → next lesson →
// … → home. Every consecutive pair whose endpoints differ is one leg. The leg's
// time window falls straight out of the sessions around it: it may start when
// the previous lesson ends (`readyMin`) and must finish before the next one
// starts (`dueMin`).
//
// Students who study at the centre can need the same thing in reverse
// (home → centre → home), so passengers are generic.
//
// All times are minutes from midnight, matching lib/planner.ts.

export type LatLng = { lat: number; lng: number };

export type PassengerKind = "TEACHER" | "STUDENT";

/** One lesson, already resolved to a place and a time window. */
export type SessionPoint = {
  sessionId: string;
  /** Where the lesson happens. Null when coordinates are missing. */
  at: LatLng | null;
  /** Human label for the stop ("Centre", a student's name/home code). */
  label: string;
  startMin: number;
  endMin: number;
};

export type PassengerDay = {
  passengerId: string;
  passengerKind: PassengerKind;
  name: string;
  /** Where the passenger starts and ends the day. Null = unknown. */
  home: LatLng | null;
  homeLabel: string;
  /** The day's lessons, any order — sorted here. */
  points: SessionPoint[];
};

export type Leg = {
  /** Stable within one generation run: `${passengerId}:${seq}`. */
  id: string;
  passengerId: string;
  passengerKind: PassengerKind;
  passengerName: string;
  from: LatLng;
  fromLabel: string;
  to: LatLng;
  toLabel: string;
  /** Earliest the passenger can be collected. */
  readyMin: number;
  /** Latest they must arrive (the next lesson's start). */
  dueMin: number;
  /** The lesson this leg delivers them to, when there is one. */
  toSessionId: string | null;
  /** The lesson they are leaving, when there is one. */
  fromSessionId: string | null;
};

export type SkippedLeg = {
  passengerId: string;
  passengerName: string;
  seq: number;
  reason: "noCoordinates";
  detail: string;
};

export type ChainOptions = {
  /** Include the trip from home to the first lesson. */
  includeFirstPickup?: boolean;
  /** Include the trip home after the last lesson. */
  includeLastDropoff?: boolean;
  /**
   * Minutes before a lesson that the passenger should arrive. The leg's `dueMin`
   * is pulled forward by this, so "arrive exactly as it starts" is never the
   * plan.
   */
  arriveEarlyMin?: number;
  /**
   * How long before their first lesson a passenger may be collected.
   *
   * The first pickup is the one leg with no natural ready time — nothing
   * precedes it. Left unbounded it reads as "collectable from midnight", and
   * the allocator, departing just-in-time against that, sends a driver at shift
   * start to deliver a teacher eight hours before their lesson. Bounding it
   * keeps the first ride in the same shape as every other one.
   */
  maxAdvancePickupMin?: number;
};

/** Two points are the same place within ~50 m — no ride needed between them. */
const SAME_PLACE_DEG = 0.0005;

function samePlace(a: LatLng, b: LatLng): boolean {
  return (
    Math.abs(a.lat - b.lat) < SAME_PLACE_DEG && Math.abs(a.lng - b.lng) < SAME_PLACE_DEG
  );
}

/**
 * Build the legs one passenger needs across their day.
 *
 * Missing coordinates never produce a guessed leg: they are reported in
 * `skipped` so the planner can show "fix this address" instead of quietly
 * stranding someone.
 */
export function legsForPassenger(
  day: PassengerDay,
  opts: ChainOptions = {},
): { legs: Leg[]; skipped: SkippedLeg[] } {
  const {
    includeFirstPickup = true,
    includeLastDropoff = true,
    arriveEarlyMin = 0,
    maxAdvancePickupMin = 60,
  } = opts;

  const points = [...day.points].sort((a, b) => a.startMin - b.startMin);
  const legs: Leg[] = [];
  const skipped: SkippedLeg[] = [];
  let seq = 0;

  const push = (
    from: LatLng | null,
    fromLabel: string,
    to: LatLng | null,
    toLabel: string,
    readyMin: number,
    dueMin: number,
    fromSessionId: string | null,
    toSessionId: string | null,
  ) => {
    seq++;
    if (!from || !to) {
      skipped.push({
        passengerId: day.passengerId,
        passengerName: day.name,
        seq,
        reason: "noCoordinates",
        detail: !from ? fromLabel : toLabel,
      });
      return;
    }
    if (samePlace(from, to)) return; // already there
    legs.push({
      id: `${day.passengerId}:${seq}`,
      passengerId: day.passengerId,
      passengerKind: day.passengerKind,
      passengerName: day.name,
      from,
      fromLabel,
      to,
      toLabel,
      readyMin,
      dueMin: dueMin - arriveEarlyMin,
      fromSessionId,
      toSessionId,
    });
  };

  if (points.length === 0) return { legs, skipped };

  // Home → first lesson.
  if (includeFirstPickup) {
    const first = points[0];
    push(
      day.home,
      day.homeLabel,
      first.at,
      first.label,
      // Bounded rather than 0: see maxAdvancePickupMin. The allocator still
      // picks the exact minute inside this window.
      Math.max(0, first.startMin - maxAdvancePickupMin),
      first.startMin,
      null,
      first.sessionId,
    );
  }

  // Lesson → next lesson.
  for (let i = 0; i < points.length - 1; i++) {
    const prev = points[i];
    const next = points[i + 1];
    push(
      prev.at,
      prev.label,
      next.at,
      next.label,
      prev.endMin,
      next.startMin,
      prev.sessionId,
      next.sessionId,
    );
  }

  // Last lesson → home.
  if (includeLastDropoff) {
    const last = points[points.length - 1];
    push(
      last.at,
      last.label,
      day.home,
      day.homeLabel,
      last.endMin,
      // No hard deadline going home; the end of the working day stands in.
      24 * 60,
      last.sessionId,
      null,
    );
  }

  return { legs, skipped };
}

/** Build legs for a whole day across every passenger. */
export function buildDayLegs(
  days: PassengerDay[],
  opts: ChainOptions = {},
): { legs: Leg[]; skipped: SkippedLeg[] } {
  const legs: Leg[] = [];
  const skipped: SkippedLeg[] = [];
  for (const day of days) {
    const r = legsForPassenger(day, opts);
    legs.push(...r.legs);
    skipped.push(...r.skipped);
  }
  // Deterministic order: by deadline, then by id, so two runs of the generator
  // produce the same board.
  legs.sort((a, b) => a.dueMin - b.dueMin || a.id.localeCompare(b.id));
  return { legs, skipped };
}
