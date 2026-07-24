"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { TRACKING_VISIBILITY, TRANSPORT_PASSENGERS } from "@/lib/enums";

export type TransportSettingsState = { ok?: boolean; error?: string };

const schema = z.object({
  enabled: z.boolean(),
  centerLat: z.coerce.number().min(-90).max(90).optional().nullable(),
  centerLng: z.coerce.number().min(-180).max(180).optional().nullable(),
  avgSpeedKmh: z.coerce.number().min(5).max(140),
  rushSpeedKmh: z.coerce.number().min(5).max(140),
  rushWindows: z.string().trim().max(120),
  detourFactor: z.coerce.number().min(1).max(3),
  minTripMin: z.coerce.number().int().min(0).max(60),
  bufferMin: z.coerce.number().int().min(0).max(120),
  maxDeadheadKm: z.coerce.number().min(1).max(200),
  pingDays: z.coerce.number().int().min(1).max(365),
  trackingVisibility: z.enum(TRACKING_VISIBILITY),
  passengers: z.enum(TRANSPORT_PASSENGERS),
  includeTeacher: z.boolean(),
  includeStudentToCenter: z.boolean(),
  includeStudentToHome: z.boolean(),
  preferredArrivalBufferMin: z.coerce.number().int().min(0).max(120),
  minArrivalBufferMin: z.coerce.number().int().min(0).max(120),
  maxEarlyArrivalMin: z.coerce.number().int().min(0).max(240),
  dismissalBufferMin: z.coerce.number().int().min(0).max(120),
  boardingTimeMin: z.coerce.number().int().min(0).max(30),
  dropoffTimeMin: z.coerce.number().int().min(0).max(30),
  maxStudentWaitMin: z.coerce.number().int().min(0).max(240),
  maxJourneyMin: z.coerce.number().int().min(0).max(600),
  minDriverTurnaroundMin: z.coerce.number().int().min(0).max(120),
  minVehicleTurnaroundMin: z.coerce.number().int().min(0).max(120),
  allowInvalidOverride: z.boolean(),
});

/**
 * Toggle and configure the optional transport module. Turning it off hides the
 * module and stops trip generation; nothing is deleted, so trips and history
 * survive and reappear when it is switched back on.
 */
export async function saveTransportSettings(
  locale: string,
  _prev: TransportSettingsState,
  formData: FormData,
): Promise<TransportSettingsState> {
  const s = await getSession();
  if (!s || s.role !== "ADMIN") return { error: "forbidden" };

  const num = (k: string) => {
    const v = (formData.get(k) ?? "").toString().trim();
    return v === "" ? null : v;
  };

  const parsed = schema.safeParse({
    enabled: formData.get("transportEnabled") === "on",
    centerLat: num("centerLat"),
    centerLng: num("centerLng"),
    avgSpeedKmh: formData.get("transportAvgSpeedKmh") || 40,
    rushSpeedKmh: formData.get("transportRushSpeedKmh") || 25,
    rushWindows: formData.get("transportRushWindows") || "07:00-09:00,16:00-19:00",
    detourFactor: formData.get("transportDetourFactor") || 1.35,
    minTripMin: formData.get("transportMinTripMin") || 5,
    bufferMin: formData.get("transportBufferMin") || 10,
    maxDeadheadKm: formData.get("transportMaxDeadheadKm") || 25,
    pingDays: formData.get("transportPingDays") || 14,
    trackingVisibility: formData.get("transportTrackingVisibility") || "ADMIN_ONLY",
    passengers: formData.get("transportPassengers") || "BOTH",
    includeTeacher: formData.get("transportIncludeTeacher") === "on",
    includeStudentToCenter: formData.get("transportIncludeStudentToCenter") === "on",
    includeStudentToHome: formData.get("transportIncludeStudentToHome") === "on",
    preferredArrivalBufferMin: formData.get("transportPreferredArrivalBufferMin") || 15,
    minArrivalBufferMin: formData.get("transportMinArrivalBufferMin") || 5,
    maxEarlyArrivalMin: formData.get("transportMaxEarlyArrivalMin") || 30,
    dismissalBufferMin: formData.get("transportDismissalBufferMin") || 10,
    boardingTimeMin: formData.get("transportBoardingTimeMin") || 2,
    dropoffTimeMin: formData.get("transportDropoffTimeMin") || 2,
    maxStudentWaitMin: formData.get("transportMaxStudentWaitMin") || 20,
    maxJourneyMin: formData.get("transportMaxJourneyMin") || 60,
    minDriverTurnaroundMin: formData.get("transportMinDriverTurnaroundMin") || 10,
    minVehicleTurnaroundMin: formData.get("transportMinVehicleTurnaroundMin") || 10,
    allowInvalidOverride: formData.get("transportAllowInvalidOverride") === "on",
  });
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const writes: [string, string][] = [
    ["transportEnabled", d.enabled ? "1" : "0"],
    ["transportAvgSpeedKmh", String(d.avgSpeedKmh)],
    ["transportRushSpeedKmh", String(d.rushSpeedKmh)],
    ["transportRushWindows", d.rushWindows],
    ["transportDetourFactor", String(d.detourFactor)],
    ["transportMinTripMin", String(d.minTripMin)],
    ["transportBufferMin", String(d.bufferMin)],
    ["transportMaxDeadheadKm", String(d.maxDeadheadKm)],
    ["transportPingDays", String(d.pingDays)],
    ["transportTrackingVisibility", d.trackingVisibility],
    ["transportPassengers", d.passengers],
    ["transportIncludeTeacher", d.includeTeacher ? "1" : "0"],
    ["transportIncludeStudentToCenter", d.includeStudentToCenter ? "1" : "0"],
    ["transportIncludeStudentToHome", d.includeStudentToHome ? "1" : "0"],
    ["transportPreferredArrivalBufferMin", String(d.preferredArrivalBufferMin)],
    ["transportMinArrivalBufferMin", String(d.minArrivalBufferMin)],
    ["transportMaxEarlyArrivalMin", String(d.maxEarlyArrivalMin)],
    ["transportDismissalBufferMin", String(d.dismissalBufferMin)],
    ["transportBoardingTimeMin", String(d.boardingTimeMin)],
    ["transportDropoffTimeMin", String(d.dropoffTimeMin)],
    ["transportMaxStudentWaitMin", String(d.maxStudentWaitMin)],
    ["transportMaxJourneyMin", String(d.maxJourneyMin)],
    ["transportMinDriverTurnaroundMin", String(d.minDriverTurnaroundMin)],
    ["transportMinVehicleTurnaroundMin", String(d.minVehicleTurnaroundMin)],
    ["transportAllowInvalidOverride", d.allowInvalidOverride ? "1" : "0"],
  ];
  // Centre coordinates are cleared rather than stored as an empty string, so
  // "not set yet" stays distinguishable from "set to 0,0" (a real place).
  if (d.centerLat != null && d.centerLng != null) {
    writes.push(["centerLat", String(d.centerLat)], ["centerLng", String(d.centerLng)]);
  } else {
    await db.setting.deleteMany({ where: { key: { in: ["centerLat", "centerLng"] } } });
  }

  for (const [key, value] of writes) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }

  await writeAudit("Setting", "transport", "UPDATE", {
    after: { enabled: d.enabled, hasCentre: d.centerLat != null },
  });
  // Layout-wide: the sidebar section appears/disappears with the flag.
  revalidatePath(`/${locale}`, "layout");
  return { ok: true };
}
