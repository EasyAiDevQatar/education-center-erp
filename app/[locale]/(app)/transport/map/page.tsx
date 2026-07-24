import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { displayName } from "@/lib/names";
import { toNumber } from "@/lib/money";
import { redirect } from "@/i18n/navigation";
import { requireTransport } from "@/lib/transport/guard";
import { loadTransportConfig } from "@/lib/transport/settings";
import { PageHeader } from "@/components/page-header";
import { LiveMapClient, type MapTrip } from "./map-client";

export default async function TransportMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireTransport(locale);
  const t = await getTranslations("transportMap");

  const config = await loadTransportConfig();

  // Staff location data. The setting is enforced HERE, in the query layer —
  // hiding the page would leave the data one fetch away.
  if (config.trackingVisibility === "ADMIN_ONLY" && session.role !== "ADMIN") {
    redirect({ href: "/transport/planner", locale });
  }

  const sp = await searchParams;
  const dParam = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const day =
    dParam && /^\d{4}-\d{2}-\d{2}$/.test(dParam)
      ? dParam
      : new Date().toISOString().slice(0, 10);

  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  // Every trip for the day, not just the ones on the road: the point of the map
  // is to see the shape of the day's driving — where each proposed route goes
  // and how they overlap — which is exactly what you cannot read off the board.
  // Cancelled trips are excluded; nobody is driving those.
  const trips = await db.trip.findMany({
    where: { date: { gte: start, lt: end }, status: { not: "CANCELLED" } },
    include: {
      driver: { include: { employee: true } },
      vehicle: true,
      stops: {
        orderBy: { seq: "asc" },
        include: { passengerTeacher: true, passengerStudent: true },
      },
      pings: { orderBy: { at: "desc" }, take: 60 },
    },
    orderBy: [{ plannedStartMin: "asc" }, { id: "asc" }],
  });

  const rows: MapTrip[] = trips.map((x) => {
    const first = x.stops[0];
    const passenger = first?.passengerTeacher ?? first?.passengerStudent ?? null;
    const latest = x.pings[0] ?? null;
    return {
      id: x.id,
      status: x.status,
      driverName: x.driver ? displayName(x.driver.employee, locale) : null,
      plate: x.vehicle?.plate ?? null,
      passengerName: passenger ? displayName(passenger, locale) : null,
      plannedStartMin: x.plannedStartMin,
      plannedEndMin: x.plannedEndMin,
      estimatedKm: toNumber(x.estimatedKm),
      // The suggested route: the stops in the order the driver should take them.
      plannedPath: x.stops.map((s) => ({
        lat: s.lat,
        lng: s.lng,
        label: s.label,
        kind: s.kind,
        plannedMin: s.plannedMin,
        arrived: s.arrivedAt !== null,
      })),
      // Pings come back newest-first; a path reads oldest-first.
      actualPath: [...x.pings].reverse().map((p) => ({ lat: p.lat, lng: p.lng })),
      position: latest ? { lat: latest.lat, lng: latest.lng } : null,
      at: latest ? latest.at.toISOString() : null,
      accuracyM: latest?.accuracyM ?? null,
    };
  });

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <LiveMapClient
        trips={rows}
        day={day}
        centre={config.centre}
        retentionDays={config.pingRetentionDays}
      />
    </div>
  );
}
