import "server-only";
import { db } from "@/lib/db";
import { displayName } from "@/lib/names";
import type { SessionTripLite } from "@/components/session-hover-card";

/**
 * The trip (if any) serving each session, for card icons and hover details.
 *
 * A session can appear on two trips — the ride bringing the teacher TO it and
 * the ride leaving it. The card answers "is someone driving me to this
 * lesson?", so the arriving ride (this session as DROPOFF) wins when both
 * exist. Cancelled trips are ignored; nobody is driving those.
 */
export async function tripsBySession(
  sessionIds: string[],
  locale: string,
): Promise<Record<string, SessionTripLite>> {
  if (sessionIds.length === 0) return {};

  const stops = await db.tripStop.findMany({
    where: { sessionId: { in: sessionIds }, trip: { status: { not: "CANCELLED" } } },
    include: {
      trip: {
        include: {
          driver: { include: { employee: true } },
          vehicle: true,
          stops: { orderBy: { seq: "asc" } },
        },
      },
    },
  });

  const out: Record<string, SessionTripLite> = {};
  for (const st of stops) {
    if (!st.sessionId) continue;
    if (out[st.sessionId] && st.kind !== "DROPOFF") continue; // arriving ride wins
    const trip = st.trip;
    out[st.sessionId] = {
      id: trip.id,
      status: trip.status,
      driverName: trip.driver ? displayName(trip.driver.employee, locale) : null,
      plate: trip.vehicle?.plate ?? null,
      startMin: trip.plannedStartMin,
      endMin: trip.plannedEndMin,
      stops: trip.stops.map((x) => ({
        lat: x.lat,
        lng: x.lng,
        label: x.label,
        kind: x.kind,
      })),
    };
  }
  return out;
}
