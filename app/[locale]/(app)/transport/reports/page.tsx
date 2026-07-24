import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { displayName } from "@/lib/names";
import { toNumber } from "@/lib/money";
import { requireTransport } from "@/lib/transport/guard";
import {
  costPerKm,
  costPerTrip,
  driverUtilisation,
  fuelEconomy,
  onTimeRate,
} from "@/lib/transport/costs";
import { PageHeader } from "@/components/page-header";
import { ReportsClient, type DriverStat, type VehicleStat } from "./reports-client";

export default async function TransportReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireTransport(locale);
  const t = await getTranslations("transportReports");

  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined)) ?? "";
  const today = new Date();
  const defFrom = new Date(today);
  defFrom.setUTCDate(defFrom.getUTCDate() - 30);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(one("from")) ? one("from") : defFrom.toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(one("to")) ? one("to") : today.toISOString().slice(0, 10);

  const gte = new Date(`${from}T00:00:00.000Z`);
  const lte = new Date(`${to}T23:59:59.999Z`);

  const [trips, fuel, maint, drivers, vehicles] = await Promise.all([
    db.trip.findMany({
      where: { date: { gte, lte } },
      include: { stops: { select: { plannedMin: true, arrivedAt: true } } },
    }),
    db.fuelLog.findMany({ where: { date: { gte, lte } }, include: { vehicle: true } }),
    db.maintenanceLog.findMany({ where: { date: { gte, lte } }, include: { vehicle: true } }),
    db.driver.findMany({ include: { employee: true } }),
    db.vehicle.findMany({ orderBy: { plate: "asc" } }),
  ]);

  // --- fleet totals -------------------------------------------------------
  const fuelCost = fuel.reduce((a, f) => a + toNumber(f.cost), 0);
  const maintCost = maint.reduce((a, m) => a + toNumber(m.cost), 0);
  const totalCost = fuelCost + maintCost;

  // Distance comes from the planner's estimates, so it is an estimate — the
  // cost-per-km figure inherits that and the UI says so.
  const countedTrips = trips.filter((x) => x.status !== "CANCELLED");
  const totalKm = countedTrips.reduce((a, x) => a + toNumber(x.estimatedKm), 0);

  // --- punctuality --------------------------------------------------------
  const arrivals = trips.flatMap((x) =>
    x.stops.map((s) => ({
      plannedMin: s.plannedMin,
      actualMin: s.arrivedAt
        ? s.arrivedAt.getUTCHours() * 60 + s.arrivedAt.getUTCMinutes()
        : null,
    })),
  );
  const punctuality = onTimeRate(arrivals);

  // --- per driver ---------------------------------------------------------
  const shifts = Object.fromEntries(
    drivers.map((d) => [d.id, { startMin: d.shiftStartMin, endMin: d.shiftEndMin }]),
  );
  const util = driverUtilisation(
    trips.map((x) => ({
      driverId: x.driverId,
      plannedStartMin: x.plannedStartMin,
      plannedEndMin: x.plannedEndMin,
      estimatedKm: toNumber(x.estimatedKm),
      status: x.status,
    })),
    shifts,
  );
  const driverStats: DriverStat[] = util.map((u) => {
    const d = drivers.find((x) => x.id === u.driverId);
    return {
      driverId: u.driverId,
      name: d ? displayName(d.employee, locale) : u.driverId,
      trips: u.trips,
      busyMin: u.busyMin,
      km: u.km,
      utilisation: u.utilisation,
    };
  });

  // --- per vehicle --------------------------------------------------------
  const vehicleStats: VehicleStat[] = vehicles.map((v) => {
    const vFuel = fuel.filter((f) => f.vehicleId === v.id);
    const vMaint = maint.filter((m) => m.vehicleId === v.id);
    const econ = fuelEconomy(
      vFuel.map((f) => ({
        date: f.date.toISOString().slice(0, 10),
        litres: toNumber(f.litres),
        cost: toNumber(f.cost),
        odometerKm: f.odometerKm,
      })),
    );
    const vTrips = countedTrips.filter((x) => x.vehicleId === v.id);
    const vKm = vTrips.reduce((a, x) => a + toNumber(x.estimatedKm), 0);
    const cost =
      vFuel.reduce((a, f) => a + toNumber(f.cost), 0) +
      vMaint.reduce((a, m) => a + toNumber(m.cost), 0);
    return {
      id: v.id,
      plate: v.plate,
      odometerKm: v.odometerKm,
      trips: vTrips.length,
      km: Math.round(vKm * 100) / 100,
      fuelCost: vFuel.reduce((a, f) => a + toNumber(f.cost), 0),
      maintCost: vMaint.reduce((a, m) => a + toNumber(m.cost), 0),
      litres: vFuel.reduce((a, f) => a + toNumber(f.litres), 0),
      kmPerLitre: econ.kmPerLitre,
      costPerKm: costPerKm(cost, vKm),
    };
  });

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ReportsClient
        filters={{ from, to }}
        totals={{
          trips: countedTrips.length,
          km: Math.round(totalKm * 100) / 100,
          fuelCost,
          maintCost,
          totalCost,
          costPerKm: costPerKm(totalCost, totalKm),
          costPerTrip: costPerTrip(totalCost, countedTrips.length),
          onTimeRate: punctuality.rate,
          onTimeMeasured: punctuality.measured,
        }}
        drivers={driverStats}
        vehicles={vehicleStats}
      />
    </div>
  );
}
