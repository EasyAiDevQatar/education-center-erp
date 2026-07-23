import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { displayName } from "@/lib/names";
import { toNumber } from "@/lib/money";
import { requireTransport } from "@/lib/transport/guard";
import { PageHeader } from "@/components/page-header";
import { TripsClient, type TripRow } from "./trips-client";

export default async function TripsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireTransport(locale);
  const t = await getTranslations("trips");

  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined)) ?? "";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(one("from")) ? one("from") : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(one("to")) ? one("to") : "";
  const status = one("status");

  // Default window: the last week plus the next week — the range a coordinator
  // is actually looking at, instead of every trip ever run.
  const today = new Date();
  const defFrom = new Date(today);
  defFrom.setUTCDate(defFrom.getUTCDate() - 7);
  const defTo = new Date(today);
  defTo.setUTCDate(defTo.getUTCDate() + 7);

  const gte = new Date(`${from || defFrom.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const lte = new Date(`${to || defTo.toISOString().slice(0, 10)}T00:00:00.000Z`);

  const trips = await db.trip.findMany({
    where: {
      date: { gte, lte },
      ...(status ? { status } : {}),
    },
    include: {
      driver: { include: { employee: true } },
      vehicle: true,
      stops: {
        orderBy: { seq: "asc" },
        include: { passengerTeacher: true, passengerStudent: true },
      },
    },
    orderBy: [{ date: "desc" }, { plannedStartMin: "asc" }],
    take: 500,
  });

  const rows: TripRow[] = trips.map((x) => {
    const first = x.stops[0];
    const last = x.stops[x.stops.length - 1];
    const passenger = first?.passengerTeacher ?? first?.passengerStudent ?? null;
    return {
      id: x.id,
      date: x.date.toISOString().slice(0, 10),
      status: x.status,
      driverName: x.driver ? displayName(x.driver.employee, locale) : null,
      plate: x.vehicle?.plate ?? null,
      passengerName: passenger ? displayName(passenger, locale) : null,
      fromLabel: first?.label ?? "",
      toLabel: last?.label ?? "",
      plannedStartMin: x.plannedStartMin,
      plannedEndMin: x.plannedEndMin,
      estimatedKm: toNumber(x.estimatedKm),
      autoAllocated: x.autoAllocated,
      stopCount: x.stops.length,
    };
  });

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <TripsClient
        trips={rows}
        filters={{
          from: from || defFrom.toISOString().slice(0, 10),
          to: to || defTo.toISOString().slice(0, 10),
          status,
        }}
      />
    </div>
  );
}
