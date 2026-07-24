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
  /** Which passenger kinds the planner generates legs for. */
  passengers: TransportPassengers;
};

const num = (v: string | undefined, fallback: number): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

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
  };
}

/** Straight-line kilometres — the distance function the allocator is given. */
export function distanceKm(a: LatLng, b: LatLng): number {
  return distanceMeters(a.lat, a.lng, b.lat, b.lng) / 1000;
}
