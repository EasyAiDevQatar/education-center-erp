"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Users, TriangleAlert, Clock, CheckCircle2, Car, MapPin } from "lucide-react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { minToHHMM } from "@/lib/planner";
import type { DispatchBoard, DriverLane, LaneTrip } from "@/lib/transport/dispatch";

/** Validation → block colour classes (colour is secondary to the label). */
function tripColour(v: string): string {
  if (v === "INVALID") return "bg-destructive/15 border-destructive/50 text-destructive";
  if (v === "WARNING") return "bg-amber-500/15 border-amber-500/50 text-amber-700 dark:text-amber-400";
  return "bg-green-500/15 border-green-600/50 text-green-700 dark:text-green-400";
}

function TripBlock({
  trip,
  axis,
  kindLabel,
}: {
  trip: LaneTrip;
  axis: { minMin: number; maxMin: number };
  kindLabel: (k: string | null) => string;
}) {
  const range = Math.max(1, axis.maxMin - axis.minMin);
  const left = ((trip.plannedStartMin - axis.minMin) / range) * 100;
  const width = Math.max(6, ((trip.plannedEndMin - trip.plannedStartMin) / range) * 100);
  return (
    <div
      className={`absolute top-1 bottom-1 overflow-hidden rounded-md border px-1.5 py-0.5 text-[10px] leading-tight ${tripColour(trip.validationStatus)}`}
      style={{ left: `${left}%`, width: `${width}%` }}
      title={`${kindLabel(trip.tripKind)} · ${minToHHMM(trip.plannedStartMin)}–${minToHHMM(trip.plannedEndMin)} · ${trip.passengerName ?? ""}`}
    >
      <div className="truncate font-medium">{kindLabel(trip.tripKind)}</div>
      <div className="truncate tabular-nums" dir="ltr">
        {minToHHMM(trip.plannedStartMin)}–{minToHHMM(trip.plannedEndMin)}
      </div>
    </div>
  );
}

export function DispatchClient({ board }: { board: DispatchBoard }) {
  const t = useTranslations("transportDispatch");
  const tp = useTranslations("transportPlanner");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const kindLabel = (k: string | null) => (k ? tp(`tripKind.${k}`) : "—");
  const go = (d: string) => router.push(`${pathname}?date=${d}`);
  const shiftDay = (delta: number) => {
    const dt = new Date(`${board.day}T00:00:00.000Z`);
    dt.setUTCDate(dt.getUTCDate() + delta);
    go(dt.toISOString().slice(0, 10));
  };

  const s = board.stats;
  const stats = useMemo(
    () => [
      { label: t("statUnassigned"), value: s.unassigned, icon: Users, tone: "text-orange-600 dark:text-orange-400" },
      { label: t("statLate"), value: s.blocked, icon: TriangleAlert, tone: "text-destructive" },
      { label: t("statRemaining"), value: s.remaining, icon: Clock, tone: "text-blue-600 dark:text-blue-400" },
      { label: t("statCompleted"), value: s.completed, icon: CheckCircle2, tone: "text-green-600 dark:text-green-400" },
      { label: t("statTotal"), value: s.totalTrips, icon: Car, tone: "text-muted-foreground" },
    ],
    [s, t],
  );

  // Hour ticks across the axis for the timeline header.
  const ticks = useMemo(() => {
    const out: number[] = [];
    const from = Math.floor(board.axis.minMin / 60) * 60;
    const to = Math.ceil(board.axis.maxMin / 60) * 60;
    for (let m = from; m <= to; m += 60) out.push(m);
    return out;
  }, [board.axis]);
  const range = Math.max(1, board.axis.maxMin - board.axis.minMin);

  return (
    <>
      {/* Day bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <Button type="button" variant="outline" size="sm" onClick={() => shiftDay(-1)}>‹</Button>
        <Input type="date" dir="ltr" value={board.day} onChange={(e) => e.target.value && go(e.target.value)} className="w-40" />
        <Button type="button" variant="outline" size="sm" onClick={() => shiftDay(1)}>›</Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => shiftDay(0)}>{t("today")}</Button>
      </div>

      {/* Stat cards */}
      <div className="mb-4 grid gap-3 grid-cols-2 sm:grid-cols-5">
        {stats.map((st) => (
          <div key={st.label} className="rounded-lg border border-border bg-card p-3">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <st.icon className={`size-3.5 ${st.tone}`} />
              {st.label}
            </p>
            <p className={`text-2xl font-semibold tabular-nums ${st.tone}`} dir="ltr">{st.value}</p>
          </div>
        ))}
      </div>

      {/* Stops summary */}
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Badge variant="muted" className="gap-1"><MapPin className="size-3.5" />{t("stopsTotal", { n: s.stops.total })}</Badge>
        <Badge variant="muted">{t("stopsHomes", { n: s.stops.homes })}</Badge>
        <Badge variant="muted">{t("toCentre", { n: s.stops.toCentre })}</Badge>
        <Badge variant="muted">{t("fromCentre", { n: s.stops.fromCentre })}</Badge>
      </div>

      {!board.centreSet && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium"><TriangleAlert className="size-4" />{tp("noCentre")}</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        {/* Driver lanes */}
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="mb-2 text-sm font-medium">{t("lanes")}</p>
          {/* Timeline header */}
          <div className="relative mb-1 h-4 text-[10px] text-muted-foreground" dir="ltr">
            {ticks.map((m) => (
              <span key={m} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${((m - board.axis.minMin) / range) * 100}%` }}>
                {minToHHMM(m)}
              </span>
            ))}
          </div>
          <div className="space-y-2">
            {board.lanes.map((lane: DriverLane) => (
              <div key={lane.driverId} className="flex items-stretch gap-2">
                <div className="w-28 shrink-0 text-xs">
                  <div className="truncate font-medium">{lane.driverName}</div>
                  <div className="text-muted-foreground" dir="ltr">
                    {lane.plate ?? "—"} · {lane.capacity}
                  </div>
                </div>
                <div className="relative h-12 flex-1 rounded-md bg-muted/40" dir="ltr">
                  {lane.trips.length === 0 ? (
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
                      {t("noTrips")}
                    </span>
                  ) : (
                    lane.trips.map((trip) => (
                      <TripBlock key={trip.id} trip={trip} axis={board.axis} kindLabel={kindLabel} />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Unassigned pool */}
        <div className="rounded-lg border border-border bg-card p-3">
          <p className="mb-2 flex items-center gap-1 text-sm font-medium">
            <Users className="size-4 text-orange-600 dark:text-orange-400" />
            {t("unassignedPool", { n: board.pool.length })}
          </p>
          {board.pool.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("poolEmpty")}</p>
          ) : (
            <ul className="space-y-2">
              {board.pool.map((p) => (
                <li key={p.passengerKey} className="rounded-md border border-border border-s-2 border-s-orange-500 p-2 text-xs">
                  <div className="font-medium">{p.passengerName}</div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>
                      {te.has(`tripProblem.${p.reason}`) ? te(`tripProblem.${p.reason}`) : t("reasonNotPlanned")}
                    </span>
                    {p.needByMin != null && p.needByMin < 24 * 60 && (
                      <span className="tabular-nums" dir="ltr">{minToHHMM(p.needByMin)}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
