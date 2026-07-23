import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { displayName } from "@/lib/names";
import { requireTransport } from "@/lib/transport/guard";
import { EXPIRY_WINDOW_DAYS, expiryLevel } from "@/lib/transport/fleet";
import { PageHeader } from "@/components/page-header";
import { DriversClient, type DriverRow, type EmployeeOpt, type VehicleOpt } from "./drivers-client";

export default async function DriversPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireTransport(locale);
  const t = await getTranslations("drivers");

  const [drivers, employees, vehicles] = await Promise.all([
    db.driver.findMany({
      include: { employee: true, defaultVehicle: true },
      orderBy: { createdAt: "asc" },
    }),
    // Anyone still employed can be given the driving role — the TRANSPORT
    // department is the common case, not a restriction (a receptionist covering
    // the school run is exactly the situation the centre is in).
    db.employee.findMany({
      where: { status: { not: "TERMINATED" } },
      orderBy: { name: "asc" },
    }),
    db.vehicle.findMany({ where: { active: true }, orderBy: { plate: "asc" } }),
  ]);

  const today = new Date();

  const rows: DriverRow[] = drivers.map((d) => ({
    id: d.id,
    employeeId: d.employeeId,
    name: displayName(d.employee, locale),
    phone: d.employee.phone,
    jobTitle: d.employee.jobTitle,
    licenceNo: d.licenceNo,
    licenceExpiry: d.licenceExpiry?.toISOString().slice(0, 10) ?? null,
    licenceLevel: expiryLevel(d.licenceExpiry, today),
    defaultVehicleId: d.defaultVehicleId,
    defaultVehiclePlate: d.defaultVehicle?.plate ?? null,
    shiftStartMin: d.shiftStartMin,
    shiftEndMin: d.shiftEndMin,
    active: d.active,
    notes: d.notes,
  }));

  const employeeOpts: EmployeeOpt[] = employees.map((e) => ({
    id: e.id,
    label: displayName(e, locale),
    jobTitle: e.jobTitle,
  }));
  const vehicleOpts: VehicleOpt[] = vehicles.map((v) => ({ id: v.id, plate: v.plate }));

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <DriversClient
        drivers={rows}
        employees={employeeOpts}
        vehicles={vehicleOpts}
        windowDays={EXPIRY_WINDOW_DAYS}
      />
    </div>
  );
}
