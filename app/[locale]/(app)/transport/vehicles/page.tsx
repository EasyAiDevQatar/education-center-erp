import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { requireTransport } from "@/lib/transport/guard";
import { EXPIRY_WINDOW_DAYS, expiryLevel, latestPerType } from "@/lib/transport/fleet";
import { PageHeader } from "@/components/page-header";
import { VehiclesClient, type VehicleRow, type VehicleAlert } from "./vehicles-client";

export default async function VehiclesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireTransport(locale);
  const t = await getTranslations("vehicles");

  const vehicles = await db.vehicle.findMany({
    orderBy: { plate: "asc" },
    include: {
      documents: { orderBy: { expiresOn: "desc" } },
      _count: { select: { drivers: true } },
    },
  });

  const today = new Date();
  const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

  const rows: VehicleRow[] = vehicles.map((v) => ({
    id: v.id,
    plate: v.plate,
    make: v.make,
    model: v.model,
    year: v.year,
    capacity: v.capacity,
    odometerKm: v.odometerKm,
    active: v.active,
    notes: v.notes,
    driverCount: v._count.drivers,
    documents: v.documents.map((d) => ({
      id: d.id,
      type: d.type,
      number: d.number,
      issuedOn: iso(d.issuedOn),
      expiresOn: iso(d.expiresOn),
      level: expiryLevel(d.expiresOn, today),
    })),
  }));

  // Alerts read only the NEWEST document per type: a renewed insurance policy
  // must silence the superseded row rather than shout about it forever. Retired
  // vehicles are excluded — their papers lapsing is not an operational problem.
  const alerts: VehicleAlert[] = vehicles
    .filter((v) => v.active)
    .flatMap((v) =>
      latestPerType(v.documents)
        .map((d) => ({
          vehicleId: v.id,
          plate: v.plate,
          type: d.type,
          expiresOn: iso(d.expiresOn),
          level: expiryLevel(d.expiresOn, today),
        }))
        .filter((a) => a.level === "expired" || a.level === "soon"),
    )
    .sort((a, b) => (a.expiresOn ?? "").localeCompare(b.expiresOn ?? ""));

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <VehiclesClient vehicles={rows} alerts={alerts} windowDays={EXPIRY_WINDOW_DAYS} />
    </div>
  );
}
