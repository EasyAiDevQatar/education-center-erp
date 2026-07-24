"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Users, TriangleAlert, Clock, CheckCircle2, Car, MapPin, GripVertical } from "lucide-react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { minToHHMM } from "@/lib/planner";
import { DispatchMap, type MapTrip } from "@/components/dispatch-map";
import { previewAssignAll, assignToDriver, unassignPassenger } from "./actions";
import type { DispatchBoard, DriverLane, LaneTrip } from "@/lib/transport/dispatch";

/** Halo colour for a lane while a pool card is being dragged over the board. */
function haloClass(status: string | undefined): string {
  if (!status) return "";
  if (status === "INVALID") return "ring-2 ring-destructive/60";
  if (status === "WARNING") return "ring-2 ring-amber-500/60";
  return "ring-2 ring-green-500/70";
}

/** Distinct per-driver colours (readable in light and dark). */
const DRIVER_PALETTE = ["#2563eb", "#16a34a", "#9333ea", "#dc2626", "#d97706", "#0891b2", "#db2777", "#4f46e5"];

/** Validation → block colour classes (colour is secondary to the label). */
function tripColour(v: string): string {
  if (v === "INVALID") return "bg-destructive/15 border-destructive/50 text-destructive";
  if (v === "WARNING") return "bg-amber-500/15 border-amber-500/50 text-amber-700 dark:text-amber-400";
  return "bg-green-500/15 border-green-600/50 text-green-700 dark:text-green-400";
}

const ROW_H = 26;

/** Stack trips that overlap in time onto separate rows (greedy interval pack),
 *  so no two blocks in a lane ever draw on top of each other. */
function packRows(trips: LaneTrip[]): { rows: number[]; count: number } {
  const rowEnd: number[] = [];
  const rows: number[] = [];
  for (const t of trips) {
    let r = rowEnd.findIndex((end) => end <= t.plannedStartMin);
    if (r === -1) {
      r = rowEnd.length;
      rowEnd.push(t.plannedEndMin);
    } else {
      rowEnd[r] = t.plannedEndMin;
    }
    rows.push(r);
  }
  return { rows, count: Math.max(1, rowEnd.length) };
}

function TripBlock({
  trip,
  axis,
  kindLabel,
  row,
  rtl,
  onDragStart,
}: {
  trip: LaneTrip;
  axis: { minMin: number; maxMin: number };
  kindLabel: (k: string | null) => string;
  row: number;
  rtl: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const range = Math.max(1, axis.maxMin - axis.minMin);
  const startPct = ((trip.plannedStartMin - axis.minMin) / range) * 100;
  const width = Math.max(7, ((trip.plannedEndMin - trip.plannedStartMin) / range) * 100);
  // Earliest sits at the inline start: left in LTR, right in Arabic RTL.
  const horiz = rtl ? { right: `${startPct}%` } : { left: `${startPct}%` };
  return (
    <div
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      className={`absolute flex items-center gap-1 overflow-hidden rounded-md border px-1.5 text-[10px] leading-none ${onDragStart ? "cursor-grab active:cursor-grabbing" : ""} ${tripColour(trip.validationStatus)}`}
      style={{ ...horiz, width: `${width}%`, top: `${row * ROW_H + 2}px`, height: `${ROW_H - 4}px` }}
      title={`${kindLabel(trip.tripKind)} · ${minToHHMM(trip.plannedStartMin)}–${minToHHMM(trip.plannedEndMin)} · ${trip.passengerName ?? ""}`}
    >
      <span className="truncate font-medium">{kindLabel(trip.tripKind)}</span>
      <span className="shrink-0 tabular-nums opacity-80" dir="ltr">
        {minToHHMM(trip.plannedStartMin)}
      </span>
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

  const rtl = locale === "ar";
  const kindLabel = (k: string | null) => (k ? tp(`tripKind.${k}`) : "—");
  const posStyle = (pct: number) => (rtl ? { right: `${pct}%` } : { left: `${pct}%` });
  const go = (d: string) => router.push(`${pathname}?date=${d}`);
  const shiftDay = (delta: number) => {
    const dt = new Date(`${board.day}T00:00:00.000Z`);
    dt.setUTCDate(dt.getUTCDate() + delta);
    go(dt.toISOString().slice(0, 10));
  };

  // --- drag-to-assign -----------------------------------------------------
  const [pending, start] = useTransition();
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [halo, setHalo] = useState<Map<string, string>>(new Map());
  const [note, setNote] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      setNote(res.error ? (t.has(`err.${res.error}`) ? t(`err.${res.error}`) : t("assignFailed")) : null);
      router.refresh();
    });

  /** Picking up a pool card: light up each lane by how well it would fit. */
  const onPoolDragStart = (e: React.DragEvent, passengerKey: string) => {
    e.dataTransfer.setData("application/x-assign", passengerKey);
    e.dataTransfer.effectAllowed = "move";
    setDragKey(passengerKey);
    previewAssignAll(locale, board.day, passengerKey).then((r) => {
      if (r.ok) setHalo(new Map(r.drivers.map((d) => [d.driverId, d.feasible ? d.status : "INVALID"])));
    });
  };
  const endDrag = () => {
    setDragKey(null);
    setHalo(new Map());
  };
  const onLaneDrop = (e: React.DragEvent, driverId: string) => {
    e.preventDefault();
    const key = e.dataTransfer.getData("application/x-assign");
    endDrag();
    if (key) run(() => assignToDriver(locale, board.day, key, driverId));
  };
  const onPoolDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const key = e.dataTransfer.getData("application/x-unassign");
    if (key) run(() => unassignPassenger(locale, board.day, key));
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

  // One colour per driver, shared by the map routes and the lane dots.
  const driverColour = useMemo(() => {
    const m = new Map<string, string>();
    board.lanes.forEach((l, i) => m.set(l.driverId, DRIVER_PALETTE[i % DRIVER_PALETTE.length]));
    return m;
  }, [board.lanes]);

  const mapTrips = useMemo<MapTrip[]>(
    () =>
      board.lanes.flatMap((lane) =>
        lane.trips.map((trip) => ({
          id: trip.id,
          color: driverColour.get(lane.driverId) ?? "#2563eb",
          dashed: trip.tripKind === "RETURN",
          geometry: trip.routeGeometry,
          stops: trip.stops.map((s) => ({ seq: s.seq, lat: s.lat, lng: s.lng, label: s.label })),
        })),
      ),
    [board.lanes, driverColour],
  );

  return (
    <>
      {/* Day bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <Button type="button" variant="outline" size="sm" onClick={() => shiftDay(-1)}>‹</Button>
        <Input type="date" dir="ltr" value={board.day} onChange={(e) => e.target.value && go(e.target.value)} className="w-40" />
        <Button type="button" variant="outline" size="sm" onClick={() => shiftDay(1)}>›</Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => shiftDay(0)}>{t("today")}</Button>
      </div>

      {note && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          {note}
        </p>
      )}

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

      {/* Spatial view: every trip on one map, coloured by driver. */}
      {mapTrips.length > 0 && (
        <div className="mb-4">
          <DispatchMap trips={mapTrips} centre={board.centre} height={340} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        {/* Driver lanes */}
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{t("lanes")}</p>
            <p className="text-[11px] text-muted-foreground">{t("dragHint")}</p>
          </div>
          {/* Timeline header — RTL-aware: earliest hour on the right in Arabic. */}
          <div className="relative mb-1 h-4 text-[10px] text-muted-foreground">
            {ticks.map((m) => (
              <span
                key={m}
                className={`absolute tabular-nums ${rtl ? "translate-x-1/2" : "-translate-x-1/2"}`}
                style={posStyle(((m - board.axis.minMin) / range) * 100)}
                dir="ltr"
              >
                {minToHHMM(m)}
              </span>
            ))}
          </div>
          <div className="space-y-2">
            {board.lanes.map((lane: DriverLane) => {
              const { rows, count } = packRows(lane.trips);
              const laneH = Math.max(44, count * ROW_H + 4);
              return (
                <div key={lane.driverId} className="flex items-stretch gap-2">
                  <div className="w-28 shrink-0 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: driverColour.get(lane.driverId) }} />
                      <span className="truncate font-medium">{lane.driverName}</span>
                    </div>
                    <div className="text-muted-foreground" dir="ltr">
                      {lane.plate ?? "—"} · {lane.capacity}
                    </div>
                  </div>
                  <div
                    className={`relative flex-1 rounded-md bg-muted/40 transition-shadow ${dragKey ? haloClass(halo.get(lane.driverId)) : ""}`}
                    style={{ height: `${laneH}px` }}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes("application/x-assign")) e.preventDefault();
                    }}
                    onDrop={(e) => onLaneDrop(e, lane.driverId)}
                  >
                    {lane.trips.length === 0 ? (
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
                        {t("noTrips")}
                      </span>
                    ) : (
                      lane.trips.map((trip, i) => (
                        <TripBlock
                          key={trip.id}
                          trip={trip}
                          axis={board.axis}
                          kindLabel={kindLabel}
                          row={rows[i]}
                          rtl={rtl}
                          onDragStart={(e) => {
                            const pkey = trip.linkGroup ? trip.linkGroup.replace(/^day:/, "") : null;
                            if (pkey) {
                              e.dataTransfer.setData("application/x-unassign", pkey);
                              e.dataTransfer.effectAllowed = "move";
                            }
                          }}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Unassigned pool — drag a card onto a lane to assign; drop a lane
            trip back here to unassign. */}
        <div
          className="rounded-lg border border-border bg-card p-3"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("application/x-unassign")) e.preventDefault();
          }}
          onDrop={onPoolDrop}
        >
          <p className="mb-2 flex items-center gap-1 text-sm font-medium">
            <Users className="size-4 text-orange-600 dark:text-orange-400" />
            {t("unassignedPool", { n: board.pool.length })}
          </p>
          {board.pool.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("poolEmpty")}</p>
          ) : (
            <ul className="space-y-2">
              {board.pool.map((p) => (
                <li
                  key={p.passengerKey}
                  draggable={!pending}
                  onDragStart={(e) => onPoolDragStart(e, p.passengerKey)}
                  onDragEnd={endDrag}
                  className="flex cursor-grab items-start gap-1 rounded-md border border-border border-s-2 border-s-orange-500 p-2 text-xs active:cursor-grabbing"
                >
                  <GripVertical className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{p.passengerName}</div>
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>
                        {te.has(`tripProblem.${p.reason}`) ? te(`tripProblem.${p.reason}`) : t("reasonNotPlanned")}
                      </span>
                      {p.needByMin != null && p.needByMin < 24 * 60 && (
                        <span className="tabular-nums" dir="ltr">{minToHHMM(p.needByMin)}</span>
                      )}
                    </div>
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
