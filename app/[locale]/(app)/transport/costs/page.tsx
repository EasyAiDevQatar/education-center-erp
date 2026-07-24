import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { requireTransport } from "@/lib/transport/guard";
import { PageHeader } from "@/components/page-header";
import { CostsClient, type FuelRow, type MaintRow, type Opt } from "./costs-client";

export default async function TransportCostsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireTransport(locale);
  const t = await getTranslations("transportCosts");

  const [fuel, maint, vehicles, suppliers, currencyRow] = await Promise.all([
    db.fuelLog.findMany({
      include: { vehicle: true, supplier: true, expense: { select: { id: true, status: true } } },
      orderBy: { date: "desc" },
      take: 500,
    }),
    db.maintenanceLog.findMany({
      include: { vehicle: true, supplier: true, expense: { select: { id: true, status: true } } },
      orderBy: { date: "desc" },
      take: 500,
    }),
    db.vehicle.findMany({ where: { active: true }, orderBy: { plate: "asc" } }),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.setting.findUnique({ where: { key: "currency" } }),
  ]);

  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  const fuelRows: FuelRow[] = fuel.map((f) => ({
    id: f.id,
    date: ymd(f.date),
    plate: f.vehicle.plate,
    litres: toNumber(f.litres),
    cost: toNumber(f.cost),
    odometerKm: f.odometerKm,
    supplierName: f.supplier?.name ?? null,
    expenseStatus: f.expense?.status ?? null,
    notes: f.notes,
  }));

  const maintRows: MaintRow[] = maint.map((m) => ({
    id: m.id,
    date: ymd(m.date),
    plate: m.vehicle.plate,
    kind: m.kind,
    description: m.description,
    cost: toNumber(m.cost),
    odometerKm: m.odometerKm,
    supplierName: m.supplier?.name ?? null,
    expenseStatus: m.expense?.status ?? null,
    nextDueKm: m.nextDueKm,
    nextDueOn: m.nextDueOn ? ymd(m.nextDueOn) : null,
  }));

  const vehicleOpts: Opt[] = vehicles.map((v) => ({ id: v.id, label: v.plate }));
  const supplierOpts: Opt[] = suppliers.map((s) => ({ id: s.id, label: s.name }));

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <CostsClient
        fuel={fuelRows}
        maintenance={maintRows}
        vehicles={vehicleOpts}
        suppliers={supplierOpts}
        currency={currencyRow?.value ?? "QAR"}
      />
    </div>
  );
}
