import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireTransport } from "@/lib/transport/guard";
import { buildDayPlan, loadDayTrips } from "@/lib/transport/trip-data";
import { PageHeader } from "@/components/page-header";
import { TransportPlannerClient, type ProblemRow } from "./planner-client";

export default async function TransportPlannerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireTransport(locale);
  const t = await getTranslations("transportPlanner");

  const sp = await searchParams;
  const dParam = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const day =
    dParam && /^\d{4}-\d{2}-\d{2}$/.test(dParam)
      ? dParam
      : new Date().toISOString().slice(0, 10);

  const [plan, trips] = await Promise.all([
    buildDayPlan(locale, day),
    loadDayTrips(locale, day),
  ]);

  // Everything the engine could not place, with the reason — the board must be
  // loud about these: each one is a passenger with no ride.
  const legById = new Map(plan.legs.map((l) => [l.id, l]));
  const problems: ProblemRow[] = [
    ...plan.unassigned.map((u) => {
      const leg = legById.get(u.legId);
      return {
        kind: "unassigned" as const,
        reason: u.reason as string,
        passengerName: leg?.passengerName ?? u.legId,
        fromLabel: leg?.fromLabel ?? "",
        toLabel: leg?.toLabel ?? "",
        dueMin: leg?.dueMin ?? null,
      };
    }),
    ...plan.skipped.map((s) => ({
      kind: "skipped" as const,
      reason: s.reason as string,
      passengerName: s.passengerName,
      fromLabel: s.detail,
      toLabel: "",
      dueMin: null,
    })),
  ];

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <TransportPlannerClient
        day={day}
        trips={trips}
        problems={problems}
        drivers={plan.drivers}
        legCount={plan.legs.length}
        centreSet={plan.centreSet}
      />
    </div>
  );
}
