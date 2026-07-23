import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { displayName } from "@/lib/names";
import { toNumber } from "@/lib/money";
import { requireDriverPortal } from "@/lib/portal";
import { DriverClient, type DriverTrip } from "./driver-client";

export default async function DriverPortalPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { driverId, session } = await requireDriverPortal(locale);
  const t = await getTranslations("driverApp");

  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(`${today}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  const trips = await db.trip.findMany({
    where: {
      driverId,
      date: { gte: start, lt: end },
      // A proposal is not the driver's business until a coordinator approves it.
      status: { in: ["ASSIGNED", "STARTED", "COMPLETED"] },
    },
    include: {
      vehicle: true,
      stops: {
        orderBy: { seq: "asc" },
        include: { passengerTeacher: true, passengerStudent: true },
      },
    },
    orderBy: { plannedStartMin: "asc" },
  });

  const rows: DriverTrip[] = trips.map((x) => ({
    id: x.id,
    status: x.status,
    plate: x.vehicle?.plate ?? null,
    plannedStartMin: x.plannedStartMin,
    plannedEndMin: x.plannedEndMin,
    estimatedKm: toNumber(x.estimatedKm),
    stops: x.stops.map((s) => {
      const passenger = s.passengerTeacher ?? s.passengerStudent ?? null;
      return {
        id: s.id,
        seq: s.seq,
        kind: s.kind,
        label: s.label,
        lat: s.lat,
        lng: s.lng,
        plannedMin: s.plannedMin,
        arrived: s.arrivedAt !== null,
        passengerName: passenger ? displayName(passenger, locale) : null,
        passengerPhone: passenger?.phone ?? null,
      };
    }),
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-1">
      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("greeting", { name: session.name })}
        </p>
      </header>
      <DriverClient trips={rows} today={today} />
    </div>
  );
}
