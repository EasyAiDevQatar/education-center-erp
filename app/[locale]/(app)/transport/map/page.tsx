import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { displayName } from "@/lib/names";
import { redirect } from "@/i18n/navigation";
import { requireTransport } from "@/lib/transport/guard";
import { loadTransportConfig } from "@/lib/transport/settings";
import { PageHeader } from "@/components/page-header";
import { LiveMapClient, type LiveDriver } from "./map-client";

export default async function TransportMapPage({
  params,
}: {
  params: Promise<{ locale: string }>;
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

  // Only today's running trips: a live map is about now, and reading back
  // through weeks of history is a different (and more invasive) question.
  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(`${today}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const trips = await db.trip.findMany({
    where: { date: { gte: start, lt: end }, status: "STARTED" },
    include: {
      driver: { include: { employee: true } },
      vehicle: true,
      stops: { orderBy: { seq: "asc" } },
      pings: { orderBy: { at: "desc" }, take: 60 },
    },
  });

  const drivers: LiveDriver[] = trips
    .filter((x) => x.driver)
    .map((x) => {
      // Pings come back newest-first; the path wants oldest-first.
      const path = [...x.pings].reverse().map((p) => ({ lat: p.lat, lng: p.lng }));
      const latest = x.pings[0] ?? null;
      return {
        tripId: x.id,
        driverName: displayName(x.driver!.employee, locale),
        plate: x.vehicle?.plate ?? null,
        at: latest ? latest.at.toISOString() : null,
        accuracyM: latest?.accuracyM ?? null,
        position: latest ? { lat: latest.lat, lng: latest.lng } : null,
        path,
        stops: x.stops.map((s) => ({
          label: s.label,
          kind: s.kind,
          lat: s.lat,
          lng: s.lng,
          arrived: s.arrivedAt !== null,
        })),
      };
    });

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <LiveMapClient
        drivers={drivers}
        centre={config.centre}
        retentionDays={config.pingRetentionDays}
      />
    </div>
  );
}
