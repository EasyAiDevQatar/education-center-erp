import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireTransport } from "@/lib/transport/guard";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
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
import { Bus, CalendarDays, CheckCircle2, Route as RouteIcon } from "lucide-react";

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

/** Driver 360 — everything one driver touches: identity, licence, shift,
 *  default vehicle, upcoming work and completed history with distance. */
export default async function DriverProfilePage({
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

  const driver = await db.driver.findUnique({
    where: { id },
    include: { employee: true, defaultVehicle: true },
  });
  if (!driver) notFound();

  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  const trips = await db.trip.findMany({
    where: { driverId: id },
    include: {
      vehicle: true,
      stops: {
        orderBy: { seq: "asc" },
        include: { passengerTeacher: true, passengerStudent: true },
      },
    },
    orderBy: [{ date: "desc" }, { plannedStartMin: "desc" }],
    take: 200,
  });

  const upcoming = trips
    .filter((x) => x.date >= today && !["COMPLETED", "CANCELLED"].includes(x.status))
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.plannedStartMin - b.plannedStartMin);
  const history = trips.filter((x) => x.status === "COMPLETED" || x.date < today);

  const completed = trips.filter((x) => x.status === "COMPLETED");
  const completedMonth = completed.filter((x) => x.date >= monthStart);
  const totalKm = completed.reduce(
    (a, x) => a + (x.actualKm != null ? toNumber(x.actualKm) : toNumber(x.estimatedKm)),
    0,
  );

  const name = displayName(driver.employee, locale);
  const licenceDays =
    driver.licenceExpiry != null
      ? Math.floor((driver.licenceExpiry.getTime() - Date.now()) / 86_400_000)
      : null;

  const passengerOf = (x: (typeof trips)[number]) => {
    const first = x.stops[0];
    const p = first?.passengerTeacher ?? first?.passengerStudent ?? null;
    return p ? displayName(p, locale) : "—";
  };
  const routeOf = (x: (typeof trips)[number]) =>
    x.stops.length ? `${x.stops[0].label} ← ${x.stops[x.stops.length - 1].label}` : "—";

  const TripTable = ({ rows }: { rows: typeof trips }) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{tc("date")}</TableHead>
          <TableHead>{t("window")}</TableHead>
          <TableHead>{t("passenger")}</TableHead>
          <TableHead>{t("route")}</TableHead>
          <TableHead>{t("vehicle")}</TableHead>
          <TableHead>{tc("status")}</TableHead>
          <TableHead>{t("km")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-muted-foreground">
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
            <TableCell>{passengerOf(x)}</TableCell>
            <TableCell className="max-w-52 truncate">{routeOf(x)}</TableCell>
            <TableCell dir="ltr">{x.vehicle?.plate ?? "—"}</TableCell>
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
        title={name}
        description={[
          driver.employee.jobTitle,
          driver.defaultVehicle ? `${t("vehicle")}: ${driver.defaultVehicle.plate}` : null,
          driver.shiftStartMin != null && driver.shiftEndMin != null
            ? `${t("shift")}: ${minToHHMM(driver.shiftStartMin)}–${minToHHMM(driver.shiftEndMin)}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("upcomingTrips")} value={String(upcoming.length)} icon={CalendarDays} />
        <StatCard label={t("completedTrips")} value={String(completed.length)} icon={CheckCircle2} />
        <StatCard label={t("completedThisMonth")} value={String(completedMonth.length)} icon={Bus} />
        <StatCard label={t("totalKm")} value={totalKm.toFixed(1)} icon={RouteIcon} />
      </div>

      <div className="mb-6 flex flex-wrap gap-2 text-sm">
        {driver.licenceNo && (
          <Badge variant="muted">
            {t("licence")}: <span dir="ltr">{driver.licenceNo}</span>
          </Badge>
        )}
        {licenceDays != null && (
          <Badge variant={licenceDays < 0 ? "destructive" : licenceDays <= 60 ? "warning" : "success"}>
            {t("licenceExpiry")}: <span dir="ltr">{driver.licenceExpiry!.toISOString().slice(0, 10)}</span>
          </Badge>
        )}
        <Badge variant={driver.active ? "success" : "muted"}>
          {driver.active ? tc("active") : tc("inactive")}
        </Badge>
        <Link href={`/employees/${driver.employeeId}`} className="text-primary hover:underline">
          {t("employeeFile")}
        </Link>
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
