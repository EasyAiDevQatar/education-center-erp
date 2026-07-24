// Turn the transport configuration into sentences a human can check.
//
// Pure module (no imports) so it is unit-tested rather than eyeballed. The
// planner's behaviour is spread across a dozen numeric settings; read one at a
// time they look harmless, but together they decide whether a driver leaves an
// hour early, whether anyone is collected at all, and whether a trip that
// cannot physically fit is still called valid. This renders the rules that are
// actually in force, and flags the values that quietly produce nonsense.
//
// Returns i18n keys + params rather than prose, so both languages stay in sync.

export type LogicInput = {
  driverModel: "DROP_AND_RETURN" | "STAY";
  maxAdvancePickupMin: number;
  includeTeacher: boolean;
  includeStudentToCenter: boolean;
  includeStudentToHome: boolean;
  avgSpeedKmh: number;
  rushSpeedKmh: number;
  detourFactor: number;
  preferredArrivalBufferMin: number;
  minArrivalBufferMin: number;
  maxEarlyArrivalMin: number;
  dismissalBufferMin: number;
  boardingTimeMin: number;
  dropoffTimeMin: number;
  maxStudentWaitMin: number;
  maxJourneyMin: number;
  minDriverTurnaroundMin: number;
  minVehicleTurnaroundMin: number;
  maxDeadheadKm: number;
  allowInvalidOverride: boolean;
};

export type LogicLine = {
  /** i18n key under `transport.logic`. */
  key: string;
  params?: Record<string, string | number>;
};

export type LogicWarning = LogicLine & {
  /** Which setting to correct — lets the UI point at the field. */
  field: string;
};

/** City driving above this is not a plausible door-to-door average. */
const IMPLAUSIBLE_SPEED_KMH = 60;

/**
 * The rules currently in force, in the order the planner applies them:
 * who is carried → when they are collected → how travel is estimated →
 * what counts as on time → what blocks approval.
 */
export function describeLogic(c: LogicInput): LogicLine[] {
  const lines: LogicLine[] = [];

  const who: string[] = [];
  if (c.includeTeacher) who.push("teacher");
  if (c.includeStudentToCenter) who.push("studentIn");
  if (c.includeStudentToHome) who.push("studentOut");
  lines.push(who.length ? { key: "who", params: { list: who.join(",") } } : { key: "whoNobody" });

  lines.push({
    key: c.driverModel === "DROP_AND_RETURN" ? "modelDropAndReturn" : "modelStay",
  });
  lines.push({ key: "advance", params: { n: c.maxAdvancePickupMin } });
  lines.push({
    key: "travel",
    params: { speed: c.avgSpeedKmh, rush: c.rushSpeedKmh, detour: c.detourFactor },
  });
  lines.push({
    key: "arrive",
    params: { preferred: c.preferredArrivalBufferMin, latest: c.minArrivalBufferMin },
  });
  lines.push({ key: "early", params: { n: c.maxEarlyArrivalMin } });
  lines.push({ key: "dismissal", params: { n: c.dismissalBufferMin } });
  lines.push({ key: "service", params: { board: c.boardingTimeMin, drop: c.dropoffTimeMin } });
  lines.push({
    key: "turnaround",
    params: { driver: c.minDriverTurnaroundMin, vehicle: c.minVehicleTurnaroundMin },
  });
  lines.push({
    key: "limits",
    params: {
      journey: c.maxJourneyMin || 0,
      wait: c.maxStudentWaitMin || 0,
      deadhead: c.maxDeadheadKm,
    },
  });
  lines.push({ key: c.allowInvalidOverride ? "approveOverride" : "approveStrict" });

  return lines;
}

/**
 * Settings that will produce trips nobody wants. Each names the field to fix,
 * so the panel can say what is wrong instead of only what is configured.
 */
export function logicWarnings(c: LogicInput): LogicWarning[] {
  const w: LogicWarning[] = [];

  if (!c.includeTeacher && !c.includeStudentToCenter && !c.includeStudentToHome) {
    w.push({ key: "warnNobody", field: "include" });
  } else if (!c.includeStudentToCenter && !c.includeStudentToHome) {
    w.push({ key: "warnNoStudents", field: "include" });
  }

  if (c.avgSpeedKmh >= IMPLAUSIBLE_SPEED_KMH) {
    w.push({ key: "warnSpeed", params: { n: c.avgSpeedKmh }, field: "avgSpeedKmh" });
  }
  if (c.preferredArrivalBufferMin === 0) {
    w.push({ key: "warnNoArrivalBuffer", field: "preferredArrivalBufferMin" });
  }
  if (c.maxEarlyArrivalMin === 0) {
    w.push({ key: "warnNoEarlyAllowance", field: "maxEarlyArrivalMin" });
  }
  if (c.boardingTimeMin === 0 && c.dropoffTimeMin === 0) {
    w.push({ key: "warnNoService", field: "boardingTimeMin" });
  }
  if (c.minDriverTurnaroundMin === 0 && c.minVehicleTurnaroundMin === 0) {
    w.push({ key: "warnNoTurnaround", field: "minDriverTurnaroundMin" });
  }
  if (c.maxJourneyMin === 0) {
    w.push({ key: "warnNoJourneyCap", field: "maxJourneyMin" });
  }
  if (c.allowInvalidOverride) {
    w.push({ key: "warnOverrideOn", field: "allowInvalidOverride" });
  }

  return w;
}

/** Values that behave sensibly for a city tutoring centre. */
export const RECOMMENDED: Pick<
  LogicInput,
  | "avgSpeedKmh"
  | "rushSpeedKmh"
  | "detourFactor"
  | "preferredArrivalBufferMin"
  | "minArrivalBufferMin"
  | "maxEarlyArrivalMin"
  | "dismissalBufferMin"
  | "boardingTimeMin"
  | "dropoffTimeMin"
  | "maxStudentWaitMin"
  | "maxJourneyMin"
  | "minDriverTurnaroundMin"
  | "minVehicleTurnaroundMin"
  | "maxAdvancePickupMin"
> = {
  avgSpeedKmh: 40,
  rushSpeedKmh: 25,
  detourFactor: 1.35,
  preferredArrivalBufferMin: 15,
  minArrivalBufferMin: 5,
  maxEarlyArrivalMin: 30,
  dismissalBufferMin: 10,
  boardingTimeMin: 2,
  dropoffTimeMin: 2,
  maxStudentWaitMin: 20,
  maxJourneyMin: 60,
  minDriverTurnaroundMin: 10,
  minVehicleTurnaroundMin: 10,
  maxAdvancePickupMin: 60,
};
