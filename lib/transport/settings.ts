import "server-only";
import { db } from "@/lib/db";
import { distanceMeters } from "@/lib/geo";
import {
  DEFAULT_SPEED_PROFILE,
  parseRushWindows,
  type SpeedProfile,
} from "./eta";
import type { LatLng } from "./allocate";
import { TRANSPORT_PASSENGERS, type TransportPassengers } from "@/lib/enums";
import type { TransportRules } from "./validate";

/** Every Setting key the transport module reads. */
export const TRANSPORT_SETTING_KEYS = [
  "transportEnabled",
  "centerLat",
  "centerLng",
  "transportAvgSpeedKmh",
  "transportRushSpeedKmh",
  "transportRushWindows",
  "transportDetourFactor",
  "transportMinTripMin",
  "transportBufferMin",
  "transportMaxDeadheadKm",
  "transportPingDays",
  "transportTrackingVisibility",
  "transportPassengers",
  // Phase-1 validation & timing tunables.
  "transportPreferredArrivalBufferMin",
  "transportMinArrivalBufferMin",
  "transportMaxEarlyArrivalMin",
  "transportDismissalBufferMin",
  "transportBoardingTimeMin",
  "transportDropoffTimeMin",
  "transportFixedDelayMin",
  "transportTrafficBufferPercent",
  "transportMaxStudentWaitMin",
  "transportMaxJourneyMin",
  "transportHardMaxJourneyMin",
  "transportMinDriverTurnaroundMin",
  "transportMinVehicleTurnaroundMin",
  "transportPreTripInspectionMin",
  "transportPostTripCloseoutMin",
  "transportAllowInvalidOverride",
  "transportAllowFallbackApproval",
  "transportSolverTimeoutSeconds",
  // Passenger/direction inclusion toggles.
  "transportIncludeTeacher",
  "transportIncludeStudentToCenter",
  "transportIncludeStudentToHome",
  // Allocation model.
  "transportMaxAdvancePickupMin",
  "transportDriverModel",
] as const;

export type TransportConfig = {
  enabled: boolean;
  centre: LatLng | null;
  profile: SpeedProfile;
  /** Minutes a passenger should arrive before the lesson starts. */
  bufferMin: number;
  maxDeadheadKm: number;
  pingRetentionDays: number;
  trackingVisibility: "ADMIN_ONLY" | "ADMIN_STAFF";
  /** Which passenger kinds the planner generates legs for (legacy coarse). */
  passengers: TransportPassengers;
  /** Fine-grained inclusion — supersedes `passengers` when set. */
  include: { teacher: boolean; studentToCenter: boolean; studentToHome: boolean };
  /** Validation & operational-timing rules (fed to lib/transport/validate). */
  rules: TransportRules;
  /** Per-stop service + delay allowances (fed to the operational breakdown). */
  operational: OperationalTunables;
  allowInvalidOverride: boolean;
  allowFallbackApproval: boolean;
  solverTimeoutSeconds: number;
  /** How long before a lesson a passenger may be collected (the first-pickup
   *  window). Smaller = drivers leave later / sit idle less. */
  maxAdvancePickupMin: number;
  /** DROP_AND_RETURN: a driver drops the passenger and is freed (the return is
   *  a separate trip, possibly another driver) — no idle during the lesson.
   *  STAY: one driver stays with the passenger through their whole chain. */
  driverModel: "DROP_AND_RETURN" | "STAY";
};

const num = (v: string | undefined, fallback: number): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Like num() but 0 is a valid value (no-limit / no-allowance settings). */
const numZ = (v: string | undefined, fallback: number): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** A boolean setting: "0" is off; anything else (incl. absent) uses fallback. */
const bool = (v: string | undefined, fallback: boolean): boolean =>
  v === undefined ? fallback : v === "1";

/**
 * The module's on switch. Read per request — never cached at module level, so
 * flipping the setting takes effect immediately (same contract as
 * `accountingEnabled`).
 */
export async function transportEnabled(): Promise<boolean> {
  const row = await db.setting.findUnique({ where: { key: "transportEnabled" } });
  return row?.value === "1";
}

/** Load the whole transport configuration in one query, defaults applied. */
export async function loadTransportConfig(): Promise<TransportConfig> {
  const rows = await db.setting.findMany({
    where: { key: { in: [...TRANSPORT_SETTING_KEYS] } },
  });
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const lat = parseFloat(s.centerLat ?? "");
  const lng = parseFloat(s.centerLng ?? "");
  const rushWindows = parseRushWindows(s.transportRushWindows);

  return {
    enabled: s.transportEnabled === "1",
    centre:
      Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
    profile: {
      baseKmh: num(s.transportAvgSpeedKmh, DEFAULT_SPEED_PROFILE.baseKmh),
      rushKmh: num(s.transportRushSpeedKmh, DEFAULT_SPEED_PROFILE.rushKmh),
      rushWindows: rushWindows.length ? rushWindows : DEFAULT_SPEED_PROFILE.rushWindows,
      detourFactor: num(s.transportDetourFactor, DEFAULT_SPEED_PROFILE.detourFactor),
      minMinutes: num(s.transportMinTripMin, DEFAULT_SPEED_PROFILE.minMinutes),
    },
    bufferMin: num(s.transportBufferMin, 10),
    maxDeadheadKm: num(s.transportMaxDeadheadKm, 25),
    pingRetentionDays: num(s.transportPingDays, 14),
    trackingVisibility:
      s.transportTrackingVisibility === "ADMIN_STAFF" ? "ADMIN_STAFF" : "ADMIN_ONLY",
    // Unset means both — the module has always planned for whoever had the
    // data, and an upgrade must not silently stop arranging someone's ride.
    passengers: TRANSPORT_PASSENGERS.includes(s.transportPassengers as TransportPassengers)
      ? (s.transportPassengers as TransportPassengers)
      : "BOTH",
    // Fine-grained inclusion. Unset falls back to the legacy `passengers` value
    // so an upgrade keeps planning for whoever it planned for before.
    include: {
      teacher: bool(s.transportIncludeTeacher, s.transportPassengers !== "STUDENTS"),
      studentToCenter: bool(s.transportIncludeStudentToCenter, s.transportPassengers !== "TEACHERS"),
      studentToHome: bool(s.transportIncludeStudentToHome, s.transportPassengers !== "TEACHERS"),
    },
    rules: {
      preferredArrivalBufferMin: numZ(s.transportPreferredArrivalBufferMin, 15),
      minArrivalBufferMin: numZ(s.transportMinArrivalBufferMin, 5),
      maxEarlyArrivalMin: numZ(s.transportMaxEarlyArrivalMin, 30),
      dismissalBufferMin: numZ(s.transportDismissalBufferMin, 10),
      maxStudentWaitMin: numZ(s.transportMaxStudentWaitMin, 20),
      maxJourneyMin: numZ(s.transportMaxJourneyMin, 60),
      hardMaxJourneyMin: numZ(s.transportHardMaxJourneyMin, 120),
      minDriverTurnaroundMin: numZ(s.transportMinDriverTurnaroundMin, 10),
      minVehicleTurnaroundMin: numZ(s.transportMinVehicleTurnaroundMin, 10),
      preTripInspectionMin: numZ(s.transportPreTripInspectionMin, 5),
      postTripCloseoutMin: numZ(s.transportPostTripCloseoutMin, 5),
    },
    operational: operationalTunables(s),
    allowInvalidOverride: bool(s.transportAllowInvalidOverride, false),
    allowFallbackApproval: bool(s.transportAllowFallbackApproval, false),
    solverTimeoutSeconds: numZ(s.transportSolverTimeoutSeconds, 20),
    maxAdvancePickupMin: numZ(s.transportMaxAdvancePickupMin, 60),
    driverModel: s.transportDriverModel === "STAY" ? "STAY" : "DROP_AND_RETURN",
  };
}

/** Extra operational-timing tunables not needed by the validator directly. */
export type OperationalTunables = {
  boardingTimeMin: number;
  dropoffTimeMin: number;
  fixedDelayMin: number;
  trafficBufferPercent: number;
};
export function operationalTunables(rows: Record<string, string>): OperationalTunables {
  return {
    boardingTimeMin: numZ(rows.transportBoardingTimeMin, 2),
    dropoffTimeMin: numZ(rows.transportDropoffTimeMin, 2),
    fixedDelayMin: numZ(rows.transportFixedDelayMin, 0),
    trafficBufferPercent: numZ(rows.transportTrafficBufferPercent, 0),
  };
}

/** Straight-line kilometres — the distance function the allocator is given. */
export function distanceKm(a: LatLng, b: LatLng): number {
  return distanceMeters(a.lat, a.lng, b.lat, b.lng) / 1000;
}
