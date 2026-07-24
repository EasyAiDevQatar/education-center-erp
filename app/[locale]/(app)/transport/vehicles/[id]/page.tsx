import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireTransport } from "@/lib/transport/guard";
import { db } from "@/lib/db";
import { formatMoney, toNumber } from "@/lib/money";
import { displayName } from "@/lib/names";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, Fuel, Gauge, Wrench } from "lucide-react";

const minToHHMM = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

const STATUS_TONE: Record<string, "success" | "warning" | "muted" | "default"> = {
  COMPLETED: "success",
  STARTED: "success",
  ASSIGNED: "default",
  PLANNED: "default",
  PROPOSED: "warning",
  CANCELLED: "muted",
};

/** Vehicle 360 — one car's whole story: papers with expiry, fuel and
 *  maintenance spend, and every trip it drove (planned and completed). */
export default async function VehicleProfilePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireTransport(locale);

  const t = await getTranslations("transport360");
  const te = await getTranslations("enums");
  const tc = await getTranslations("common");

  const vehicle = await db.vehicle.findUnique({
    where: { id },
    include: {
      documents: { orderBy: { expiresOn: "asc" } },
      drivers: { include: { employee: true } },
    },
  });
  if (!vehicle) notFound();

  const [trips, fuel, maintenance, currencyRow] = await Promise.all([
    db.trip.findMany({
      where: { vehicleId: id },
      include: {
        driver: { include: { employee: true } },
        stops: { orderBy: { seq: "asc" } },
      },
      orderBy: [{ date: "desc" }, { plannedStartMin: "desc" }],
      take: 200,
    }),
    db.fuelLog.findMany({ where: { vehicleId: id }, orderBy: { date: "desc" } }),
    db.maintenanceLog.findMany({ where: { vehicleId: id }, orderBy: { date: "desc" } }),
    db.setting.findUnique({ where: { key: "currency" } }),
  ]);
  const currency = currencyRow?.value ?? "QAR";

  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const upcoming = trips
    .filter((x) => x.date >= today && !["COMPLETED", "CANCELLED"].includes(x.status))
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.plannedStartMin - b.plannedStartMin);
  const history = trips.filter((x) => x.status === "COMPLETED" || x.date < today);
  const completed = trips.filter((x) => x.status === "COMPLETED");
  const totalKm = completed.reduce(
    (a, x) => a + (x.actualKm != null ? toNumber(x.actualKm) : toNumber(x.estimatedKm)),
    0,
  );
  const fuelCost = fuel.reduce((a, f) => a + toNumber(f.cost), 0);
  const maintCost = maintenance.reduce((a, m) => a + toNumber(m.cost), 0);

  const docDays = (d: Date | null) =>
    d == null ? null : Math.floor((d.getTime() - Date.now()) / 86_400_000);

  const routeOf = (x: (typeof trips)[number]) =>
    x.stops.length ? `${x.stops[0].label} ← ${x.stops[x.stops.length - 1].label}` : "—";

  const TripTable = ({ rows }: { rows: typeof trips }) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{tc("date")}</TableHead>
          <TableHead>{t("window")}</TableHead>
          <TableHead>{t("driver")}</TableHead>
          <TableHead>{t("route")}</TableHead>
          <TableHead>{tc("status")}</TableHead>
          <TableHead>{t("km")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-muted-foreground">
              {tc("noData")}
            </TableCell>
          </TableRow>
        )}
        {rows.slice(0, 30).map((x) => (
          <TableRow key={x.id}>
            <TableCell className="tabular-nums" dir="ltr">
              {x.date.toISOString().slice(0, 10)}
            </TableCell>
            <TableCell className="tabular-nums" dir="ltr">
              {minToHHMM(x.plannedStartMin)}–{minToHHMM(x.plannedEndMin)}
            </TableCell>
            <TableCell>{x.driver ? displayName(x.driver.employee, locale) : "—"}</TableCell>
            <TableCell className="max-w-52 truncate">{routeOf(x)}</TableCell>
            <TableCell>
              <Badge variant={STATUS_TONE[x.status] ?? "default"}>
                {te(`tripStatus.${x.status as "PLANNED"}`)}
              </Badge>
            </TableCell>
            <TableCell className="tabular-nums" dir="ltr">
              {x.actualKm != null ? toNumber(x.actualKm) : toNumber(x.estimatedKm)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div>
      <PageHeader
        title={vehicle.plate}
        description={[
          [vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" "),
          `${t("capacity")}: ${vehicle.capacity}`,
          vehicle.drivers.length
            ? `${t("defaultDriverOf")}: ${vehicle.drivers.map((d) => displayName(d.employee, locale)).join("، ")}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("odometer")} value={String(vehicle.odometerKm)} suffix="km" icon={Gauge} />
        <StatCard label={t("completedTrips")} value={String(completed.length)} icon={CheckCircle2} />
        <StatCard
          label={t("fuelCost")}
          value={`${formatMoney(fuelCost)} ${currency}`}
          icon={Fuel}
        />
        <StatCard
          label={t("maintenanceCost")}
          value={`${formatMoney(maintCost)} ${currency}`}
          icon={Wrench}
        />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("documents")}</CardTitle>
          </CardHeader>
          <CardContent>
            {vehicle.documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tc("noData")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {vehicle.documents.map((d) => {
                  const days = docDays(d.expiresOn);
                  return (
                    <li key={d.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{te(`vehicleDocType.${d.type as "REGISTRATION"}`)}</span>
                      {d.number && <span dir="ltr" className="text-muted-foreground">{d.number}</span>}
                      {d.expiresOn && (
                        <Badge variant={days! < 0 ? "destructive" : days! <= 60 ? "warning" : "success"}>
                          <span dir="ltr">{d.expiresOn.toISOString().slice(0, 10)}</span>
                        </Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("recentCosts")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {[...fuel.slice(0, 5).map((f) => ({
                key: `f-${f.id}`,
                date: f.date,
                label: `${t("fuel")} · ${toNumber(f.litres)} L`,
                cost: toNumber(f.cost),
              })),
              ...maintenance.slice(0, 5).map((m) => ({
                key: `m-${m.id}`,
                date: m.date,
                label: `${te(`maintenanceKind.${m.kind as "SERVICE"}`)} · ${m.description}`,
                cost: toNumber(m.cost),
              }))]
                .sort((a, b) => b.date.getTime() - a.date.getTime())
                .slice(0, 8)
                .map((row) => (
                  <li key={row.key} className="flex items-baseline justify-between gap-2">
                    <span className="truncate">
                      <span className="tabular-nums text-muted-foreground" dir="ltr">
                        {row.date.toISOString().slice(0, 10)}
                      </span>{" "}
                      {row.label}
                    </span>
                    <span className="shrink-0 tabular-nums" dir="ltr">
                      {formatMoney(row.cost)} {currency}
                    </span>
                  </li>
                ))}
              {fuel.length === 0 && maintenance.length === 0 && (
                <li className="text-muted-foreground">{tc("noData")}</li>
              )}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              {t("kmDriven")}: <span dir="ltr">{totalKm.toFixed(1)}</span> km ·{" "}
              <Link href="/transport/costs" className="text-primary hover:underline">
                {t("allCosts")}
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("upcomingTrips")}</CardTitle>
          </CardHeader>
          <CardContent>
            <TripTable rows={upcoming} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("tripHistory")}</CardTitle>
          </CardHeader>
          <CardContent>
            <TripTable rows={history} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
