// Transport route validation — the engine that decides whether a trip may be
// approved. Pure module (no imports, no `server-only`): every rule here is the
// difference between a student reaching their lesson on time and a route that
// looks efficient on the map but drops someone after class started, so each is
// unit-tested rather than discovered in production.
//
// The session schedule is the hard constraint. A geographically good route is
// never VALID when it violates a passenger's session window (spec §2, §21).
//
// All times are minutes from midnight, matching lib/planner.ts and eta.ts.

export type ValidationLevel = "VALID" | "WARNING" | "INVALID";

/** Reason codes attached to messages and unassigned requests (spec §31, §21). */
export type ValidationCode =
  | "ARRIVAL_AFTER_LATEST"
  | "ARRIVAL_AFTER_SESSION_START"
  | "EXCESSIVE_EARLY_ARRIVAL"
  | "SMALL_ARRIVAL_BUFFER"
  | "DEPART_BEFORE_READY"
  | "EXCESSIVE_WAIT"
  | "JOURNEY_TOO_LONG"
  | "JOURNEY_EXCEEDS_HARD_MAX"
  | "TRAVEL_TIME_FALLBACK_USED"
  | "TURNAROUND_TIME_INSUFFICIENT"
  | "MISSING_SESSION_WINDOW";

export type ValidationMessage = {
  code: ValidationCode;
  level: ValidationLevel;
  stopSeq?: number;
  text: string;
};

/** The tunables the validator needs (a subset of the transport config). */
export type TransportRules = {
  preferredArrivalBufferMin: number; // ideal minutes early
  minArrivalBufferMin: number; // must arrive at least this early
  maxEarlyArrivalMin: number; // earlier than this → excessive-early warning
  dismissalBufferMin: number; // may leave only this long after the lesson ends
  maxStudentWaitMin: number; // 0 = no limit
  maxJourneyMin: number; // WARNING threshold, 0 = no limit
  hardMaxJourneyMin: number; // INVALID threshold, 0 = no limit
  minDriverTurnaroundMin: number;
  minVehicleTurnaroundMin: number;
  preTripInspectionMin: number;
  postTripCloseoutMin: number;
};

/** Arrival window for a home→centre (pickup) leg (spec §6.1). */
export function arrivalWindow(sessionStartMin: number, r: TransportRules) {
  return {
    preferred: sessionStartMin - r.preferredArrivalBufferMin,
    latest: sessionStartMin - r.minArrivalBufferMin,
    earliest: sessionStartMin - r.maxEarlyArrivalMin,
  };
}

/** Earliest a centre→home (return) leg may leave (spec §6.2). */
export function departureFloor(sessionEndMin: number, r: TransportRules): number {
  return sessionEndMin + r.dismissalBufferMin;
}

const worst = (a: ValidationLevel, b: ValidationLevel): ValidationLevel =>
  a === "INVALID" || b === "INVALID"
    ? "INVALID"
    : a === "WARNING" || b === "WARNING"
      ? "WARNING"
      : "VALID";

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;

/** One passenger being delivered to a lesson (pickup direction). */
export function validateArrival(
  arrivalMin: number,
  sessionStartMin: number,
  r: TransportRules,
  stopSeq?: number,
): ValidationMessage[] {
  const w = arrivalWindow(sessionStartMin, r);
  const msgs: ValidationMessage[] = [];
  if (arrivalMin >= sessionStartMin) {
    msgs.push({
      code: "ARRIVAL_AFTER_SESSION_START",
      level: "INVALID",
      stopSeq,
      text: `Arrives ${hhmm(arrivalMin)} — after the lesson starts (${hhmm(sessionStartMin)}).`,
    });
  } else if (arrivalMin > w.latest) {
    msgs.push({
      code: "ARRIVAL_AFTER_LATEST",
      level: "INVALID",
      stopSeq,
      text: `Arrives ${hhmm(arrivalMin)} — later than the latest allowed ${hhmm(w.latest)}.`,
    });
  } else if (arrivalMin < w.earliest) {
    msgs.push({
      code: "EXCESSIVE_EARLY_ARRIVAL",
      level: "WARNING",
      stopSeq,
      text: `Arrives ${hhmm(arrivalMin)} — more than ${r.maxEarlyArrivalMin} min before the lesson.`,
    });
  }
  return msgs;
}

/** One passenger leaving a lesson (return direction). */
export function validateDeparture(
  departureMin: number,
  sessionEndMin: number,
  r: TransportRules,
  stopSeq?: number,
): ValidationMessage[] {
  const readyFrom = departureFloor(sessionEndMin, r);
  const msgs: ValidationMessage[] = [];
  if (departureMin < readyFrom) {
    msgs.push({
      code: "DEPART_BEFORE_READY",
      level: "INVALID",
      stopSeq,
      text: `Leaves ${hhmm(departureMin)} — before the student is ready at ${hhmm(readyFrom)}.`,
    });
  } else if (r.maxStudentWaitMin > 0 && departureMin - readyFrom > r.maxStudentWaitMin) {
    msgs.push({
      code: "EXCESSIVE_WAIT",
      level: "WARNING",
      stopSeq,
      text: `Waits ${departureMin - readyFrom} min after being ready.`,
    });
  }
  return msgs;
}

/** Can a driver/vehicle get from one trip's end to the next trip's start in
 *  time (spec §20)? Checked independently for driver and vehicle. */
export function turnaroundFeasible(
  prevEndMin: number,
  nextStartMin: number,
  deadheadMin: number,
  minTurnaroundMin: number,
  r: TransportRules,
): boolean {
  return (
    prevEndMin + r.postTripCloseoutMin + deadheadMin + minTurnaroundMin + r.preTripInspectionMin <=
    nextStartMin
  );
}

export type StopForValidation = {
  seq: number;
  kind: string; // PICKUP | DROPOFF
  plannedMin: number;
  /** The lesson this stop serves, if any. */
  sessionStartMin?: number | null;
  sessionEndMin?: number | null;
  fallbackUsed?: boolean;
  /** True when this stop delivers to / leaves the centre-based lesson so the
   *  arrival (pickup dir) or departure (return dir) window applies. */
  servesSession?: boolean;
};

export type TripValidation = {
  status: ValidationLevel;
  messages: ValidationMessage[];
};

/**
 * Validate a whole trip against every assigned passenger's session window.
 *
 * A stop that serves a lesson is checked both ways where data allows: a
 * DROPOFF must arrive inside the lesson's arrival window; a PICKUP leaving a
 * lesson must not depart before the student is ready. Any fallback-estimated
 * leg downgrades the trip to at least WARNING (spec §14).
 */
export function validateTrip(stops: StopForValidation[], r: TransportRules): TripValidation {
  const messages: ValidationMessage[] = [];
  let anyFallback = false;

  for (const st of stops) {
    if (st.fallbackUsed) anyFallback = true;
    if (!st.servesSession) continue;

    if (st.kind === "DROPOFF" && st.sessionStartMin != null) {
      messages.push(...validateArrival(st.plannedMin, st.sessionStartMin, r, st.seq));
    }
    if (st.kind === "PICKUP" && st.sessionEndMin != null) {
      messages.push(...validateDeparture(st.plannedMin, st.sessionEndMin, r, st.seq));
    }
  }

  // Journey time = last stop minus first stop.
  if (stops.length >= 2) {
    const journey = stops[stops.length - 1].plannedMin - stops[0].plannedMin;
    if (r.hardMaxJourneyMin > 0 && journey > r.hardMaxJourneyMin) {
      messages.push({
        code: "JOURNEY_EXCEEDS_HARD_MAX",
        level: "INVALID",
        text: `Journey ${journey} min exceeds the hard maximum ${r.hardMaxJourneyMin} min.`,
      });
    } else if (r.maxJourneyMin > 0 && journey > r.maxJourneyMin) {
      messages.push({
        code: "JOURNEY_TOO_LONG",
        level: "WARNING",
        text: `Journey ${journey} min is unusually long.`,
      });
    }
  }

  if (anyFallback) {
    messages.push({
      code: "TRAVEL_TIME_FALLBACK_USED",
      level: "WARNING",
      text: "Travel times are estimated (straight-line), not road-network calculated.",
    });
  }

  const status = messages.reduce<ValidationLevel>((acc, m) => worst(acc, m.level), "VALID");
  return { status, messages };
}
