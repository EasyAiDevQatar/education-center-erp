"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Users, TriangleAlert, Clock, CheckCircle2, Car, GripVertical,
  Home, Building2, Flag, RefreshCw, Download, Map as MapIcon, Table2,
} from "lucide-react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { minToHHMM } from "@/lib/planner";
import { DispatchMap, type MapTrip } from "@/components/dispatch-map";
import { previewAssignAll, assignToDriver, unassignPassenger } from "./actions";
import type { DispatchBoard, DriverLane, LaneTrip } from "@/lib/transport/dispatch";

const DRIVER_PALETTE = ["#2563eb", "#16a34a", "#9333ea", "#dc2626", "#d97706", "#0891b2", "#db2777", "#4f46e5"];

function haloClass(status: string | undefined): string {
  if (!status) return "";
  if (status === "INVALID") return "ring-2 ring-destructive/60";
  if (status === "WARNING") return "ring-2 ring-amber-500/60";
  return "ring-2 ring-green-500/70";
}

/** Lane roll-up status → the badge shown in the status column (mockup image 1). */
function laneStatus(lane: DriverLane): { key: string; cls: string } {
  if (lane.trips.length === 0) return { key: "unassigned", cls: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" };
  if (lane.trips.some((t) => t.validationStatus === "INVALID")) return { key: "late", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" };
  if (lane.trips.every((t) => t.status === "COMPLETED")) return { key: "completed", cls: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" };
  return { key: "remaining", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" };
}

export function DispatchClient({ board }: { board: DispatchBoard }) {
  const t = useTranslations("transportDispatch");
  const tp = useTranslations("transportPlanner");
  const te = useTranslations("enums");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const rtl = locale === "ar";
  const S = rtl ? "right" : "left"; // inline-start physical side
  const kindLabel = (k: string | null) => (k ? tp(`tripKind.${k}`) : "—");
  const go = (d: string) => router.push(`${pathname}?date=${d}`);
  const shiftDay = (delta: number) => {
    const dt = new Date(`${board.day}T00:00:00.000Z`);
    dt.setUTCDate(dt.getUTCDate() + delta);
    go(dt.toISOString().slice(0, 10));
  };

  // --- state --------------------------------------------------------------
  const [pending, start] = useTransition();
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [halo, setHalo] = useState<Map<string, string>>(new Map());
  const [note, setNote] = useState<string | null>(null);
  const [lastAssign, setLastAssign] = useState<string | null>(null);
  const [driverFilter, setDriverFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [mapOnly, setMapOnly] = useState(false);

  const errMsg = (code?: string) =>
    code ? (t.has(`err.${code}`) ? t(`err.${code}`) : t("assignFailed")) : null;
  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      setNote(errMsg(res.error));
      router.refresh();
    });
  const reasonLabel = (code: string) =>
    tc.has(`validationCode.${code}`) ? tc(`validationCode.${code}`) : code;

  const onPoolDragStart = (e: React.DragEvent, passengerKey: string) => {
    e.dataTransfer.setData("application/x-assign", passengerKey);
    e.dataTransfer.effectAllowed = "move";
    setDragKey(passengerKey);
    previewAssignAll(locale, board.day, passengerKey).then((r) => {
      if (r.ok) setHalo(new Map(r.drivers.map((d) => [d.driverId, d.feasible ? d.status : "INVALID"])));
    });
  };
  const endDrag = () => { setDragKey(null); setHalo(new Map()); };
  const onLaneDrop = (e: React.DragEvent, driverId: string) => {
    e.preventDefault();
    const key = e.dataTransfer.getData("application/x-assign");
    endDrag();
    if (!key) return;
    start(async () => {
      const res = await assignToDriver(locale, board.day, key, driverId);
      setNote(errMsg(res.error));
      if (res.ok) setLastAssign(key);
      router.refresh();
    });
  };
  const undoLast = () => {
    if (!lastAssign) return;
    const key = lastAssign;
    setLastAssign(null);
    run(() => unassignPassenger(locale, board.day, key));
  };
  const onPoolDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const key = e.dataTransfer.getData("application/x-unassign");
    if (key) run(() => unassignPassenger(locale, board.day, key));
  };

  const exportCsv = () => {
    const rows = [["driver", "vehicle", "trip", "start", "end", "km", "status"]];
    for (const lane of board.lanes)
      for (const tr of lane.trips)
        rows.push([lane.driverName, lane.plate ?? "", kindLabel(tr.tripKind), minToHHMM(tr.plannedStartMin), minToHHMM(tr.plannedEndMin), String(tr.estimatedKm), tr.validationStatus]);
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `dispatch-${board.day}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const s = board.stats;
  const near = (lat: number, lng: number) =>
    board.centre != null && Math.abs(lat - board.centre.lat) < 0.0005 && Math.abs(lng - board.centre.lng) < 0.0005;

  const stats = [
    { label: t("statUnassigned"), value: s.unassigned, icon: Users, tone: "text-orange-500", bg: "bg-orange-50 dark:bg-orange-950/40" },
    { label: t("statLate"), value: s.blocked, icon: TriangleAlert, tone: "text-red-500", bg: "bg-red-50 dark:bg-red-950/40" },
    { label: t("statRemaining"), value: s.remaining, icon: Clock, tone: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-950/40" },
    { label: t("statCompleted"), value: s.completed, icon: CheckCircle2, tone: "text-green-600", bg: "bg-green-50 dark:bg-green-950/40" },
    { label: t("statTotal"), value: s.totalTrips, icon: Car, tone: "text-slate-500", bg: "bg-slate-50 dark:bg-slate-900/60" },
  ];

  // Status-summary bar segments (disjoint-ish, matching the mockup's four bands).
  const segs = [
    { n: s.unassigned, c: "#f59e0b", label: t("statUnassigned") },
    { n: s.blocked, c: "#ef4444", label: t("statLate") },
    { n: Math.max(0, s.remaining - s.blocked), c: "#3b82f6", label: t("statRemaining") },
    { n: s.completed, c: "#22c55e", label: t("statCompleted") },
  ];
  const segTotal = Math.max(1, segs.reduce((a, x) => a + x.n, 0));

  const stopTiles = [
    { label: t("stopDepartCentre"), value: s.stops.fromCentre, icon: Flag, tone: "text-purple-500" },
    { label: t("stopArriveCentre"), value: s.stops.toCentre, icon: Building2, tone: "text-blue-500" },
    { label: t("stopHomes"), value: s.stops.homes, icon: Home, tone: "text-green-600" },
    { label: t("stopTotal"), value: s.stops.total, icon: MapIcon, tone: "text-slate-500" },
  ];

  const ticks = useMemo(() => {
    const out: number[] = [];
    const from = Math.floor(board.axis.minMin / 60) * 60;
    const to = Math.ceil(board.axis.maxMin / 60) * 60;
    for (let m = from; m <= to; m += 60) out.push(m);
    return out;
  }, [board.axis]);
  const range = Math.max(1, board.axis.maxMin - board.axis.minMin);
  const pct = (m: number) => ((m - board.axis.minMin) / range) * 100;

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
          stops: trip.stops.map((st) => ({ seq: st.seq, lat: st.lat, lng: st.lng, label: st.label })),
        })),
      ),
    [board.lanes, driverColour],
  );

  const tripPasses = (tr: LaneTrip) =>
    (statusFilter === "all" || tr.validationStatus === statusFilter) &&
    (directionFilter === "all" || tr.tripKind === directionFilter) &&
    (!exceptionsOnly || tr.validationStatus !== "VALID");

  const visibleLanes = board.lanes.filter((l) => driverFilter === "all" || l.driverId === driverFilter);

  return (
    <>
      {/* Day bar with export / refresh + map/table toggle */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={exportCsv}>
          <Download className="size-3.5" />{t("export")}
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1" disabled={pending} onClick={() => router.refresh()}>
          <RefreshCw className="size-3.5" />{t("refresh")}
        </Button>
        <div className="ms-2 flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => shiftDay(-1)}>‹</Button>
          <Input type="date" dir="ltr" value={board.day} onChange={(e) => e.target.value && go(e.target.value)} className="w-36" />
          <Button type="button" variant="outline" size="sm" onClick={() => shiftDay(1)}>›</Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => shiftDay(0)}>{t("today")}</Button>
        </div>
        <div className="ms-auto flex items-center gap-2">
          {lastAssign && (
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={undoLast}>{t("undo")}</Button>
          )}
          <Button type="button" variant={mapOnly ? "outline" : "secondary"} size="sm" className="gap-1" onClick={() => setMapOnly(false)}>
            <Table2 className="size-3.5" />{t("mapAndTable")}
          </Button>
          <Button type="button" variant={mapOnly ? "secondary" : "outline"} size="sm" className="gap-1" onClick={() => setMapOnly(true)}>
            <MapIcon className="size-3.5" />{t("mapOnly")}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Select value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)} className="h-8 w-40 text-xs">
          <option value="all">{t("allDrivers")}</option>
          {board.lanes.map((l) => <option key={l.driverId} value={l.driverId}>{l.driverName}</option>)}
        </Select>
        <Select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)} className="h-8 w-40 text-xs">
          <option value="all">{t("allDirections")}</option>
          <option value="PICKUP">{tp("tripKind.PICKUP")}</option>
          <option value="RETURN">{tp("tripKind.RETURN")}</option>
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 w-36 text-xs">
          <option value="all">{t("allStatuses")}</option>
          <option value="INVALID">{tp("validation.INVALID")}</option>
          <option value="WARNING">{tp("validation.WARNING")}</option>
          <option value="VALID">{tp("validation.VALID")}</option>
        </Select>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs">
          <input type="checkbox" checked={exceptionsOnly} onChange={(e) => setExceptionsOnly(e.target.checked)} />
          {t("exceptionsOnly")}
        </label>
      </div>

      {note && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{note}</p>
      )}

      {/* Stat tiles (image 2) */}
      <div className="mb-4 grid gap-3 grid-cols-2 sm:grid-cols-5">
        {stats.map((st) => (
          <div key={st.label} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{st.label}</span>
              <span className={`flex size-7 items-center justify-center rounded-lg ${st.bg}`}>
                <st.icon className={`size-4 ${st.tone}`} />
              </span>
            </div>
            <p className={`mt-1 text-3xl font-semibold tabular-nums ${st.tone}`} dir="ltr">{st.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        {/* Status summary bar */}
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-sm font-medium">{t("statusSummary")}</p>
          <div className="flex h-6 overflow-hidden rounded-md" dir="ltr">
            {segs.map((sg) => sg.n > 0 && (
              <div key={sg.label} title={`${sg.label}: ${sg.n}`} className="flex items-center justify-center text-[11px] font-medium text-white" style={{ width: `${(sg.n / segTotal) * 100}%`, background: sg.c }}>
                {sg.n}
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {segs.map((sg) => (
              <span key={sg.label} className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-sm" style={{ background: sg.c }} />{sg.label}
              </span>
            ))}
          </div>
        </div>

        {/* Stops summary tiles */}
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-sm font-medium">{t("stopsSummary")}</p>
          <div className="grid grid-cols-4 gap-2">
            {stopTiles.map((tile) => (
              <div key={tile.label} className="rounded-lg bg-muted/40 p-2 text-center">
                <tile.icon className={`mx-auto size-4 ${tile.tone}`} />
                <p className="mt-1 text-lg font-semibold tabular-nums" dir="ltr">{tile.value}</p>
                <p className="text-[10px] leading-tight text-muted-foreground">{tile.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!board.centreSet && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium"><TriangleAlert className="size-4" />{tp("noCentre")}</p>
        </div>
      )}

      {/* Map */}
      {mapTrips.length > 0 && (
        <div className="mb-4">
          <DispatchMap trips={mapTrips} centre={board.centre} centreLabel={t("centre")} height={360} />
        </div>
      )}

      {!mapOnly && (
        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          {/* Timeline table (image 1) */}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <p className="border-b border-border p-3 text-sm font-medium">{t("scheduleTitle")}</p>
            {/* Column header */}
            <div className="flex items-stretch gap-2 border-b border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
              <div className="relative flex-1">
                {ticks.map((m) => (
                  <span key={m} className={`absolute tabular-nums ${rtl ? "translate-x-1/2" : "-translate-x-1/2"}`} style={{ [S]: `${pct(m)}%` } as React.CSSProperties} dir="ltr">{minToHHMM(m)}</span>
                ))}
              </div>
              <div className="w-20 shrink-0 text-center font-medium">{t("colStatus")}</div>
              <div className="w-28 shrink-0 font-medium">{t("colDriver")}</div>
            </div>

            {/* Rows */}
            <div>
              {visibleLanes.map((lane) => {
                const trips = lane.trips.filter(tripPasses);
                const st = laneStatus(lane);
                return (
                  <div key={lane.driverId} className="flex items-stretch gap-2 border-b border-border px-3 py-2 last:border-b-0">
                    {/* timeline cell — drop target */}
                    <div
                      className={`relative h-11 flex-1 rounded-md ${dragKey ? "bg-muted/40 " + haloClass(halo.get(lane.driverId)) : ""}`}
                      onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-assign")) e.preventDefault(); }}
                      onDrop={(e) => onLaneDrop(e, lane.driverId)}
                    >
                      {/* baseline */}
                      <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
                      {trips.length === 0 ? (
                        <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
                          {lane.trips.length === 0 ? t("noTrips") : t("noMatch")}
                        </span>
                      ) : (
                        trips.map((trip) => {
                          const color = driverColour.get(lane.driverId) ?? "#2563eb";
                          const dashed = trip.tripKind === "RETURN";
                          const stops = [...trip.stops].sort((a, b) => a.plannedMin - b.plannedMin);
                          const a = pct(stops[0].plannedMin);
                          const b = pct(stops[stops.length - 1].plannedMin);
                          const lo = Math.min(a, b), span = Math.abs(b - a);
                          const tooltip = [
                            `${kindLabel(trip.tripKind)} · ${minToHHMM(trip.plannedStartMin)}–${minToHHMM(trip.plannedEndMin)}${trip.passengerName ? " · " + trip.passengerName : ""}`,
                            ...trip.validationMessages.map((m) => `• ${reasonLabel(m.code)}`),
                          ].join("\n");
                          const pkey = trip.linkGroup ? trip.linkGroup.replace(/^day:/, "") : null;
                          return (
                            <div key={trip.id}>
                              {/* connecting line — draggable to unassign */}
                              <div
                                draggable={!!pkey}
                                title={tooltip}
                                onDragStart={(e) => { if (pkey) { e.dataTransfer.setData("application/x-unassign", pkey); e.dataTransfer.effectAllowed = "move"; } }}
                                className="absolute flex h-4 -translate-y-1/2 cursor-grab items-center active:cursor-grabbing"
                                style={{ top: "50%", [S]: `${lo}%`, width: `${Math.max(span, 0.5)}%` } as React.CSSProperties}
                              >
                                <div className="w-full" style={{ borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}` }} />
                              </div>
                              {/* stop markers */}
                              {stops.map((st2) => {
                                const isCentre = near(st2.lat, st2.lng);
                                const Icon = isCentre ? (st2.kind === "PICKUP" ? Flag : Building2) : Home;
                                return (
                                  <span
                                    key={st2.seq}
                                    title={`${st2.seq}. ${st2.label} · ${minToHHMM(st2.plannedMin)}`}
                                    className="absolute top-1/2 flex size-5 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-full border-2 bg-card"
                                    style={{ [S]: `${pct(st2.plannedMin)}%`, borderColor: color, color } as React.CSSProperties}
                                  >
                                    <Icon className="size-2.5" />
                                  </span>
                                );
                              })}
                            </div>
                          );
                        })
                      )}
                    </div>
                    {/* status */}
                    <div className="flex w-20 shrink-0 items-center justify-center">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${st.cls}`}>{t(`laneStatus.${st.key}`)}</span>
                    </div>
                    {/* driver / vehicle */}
                    <div className="w-28 shrink-0 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="size-2 shrink-0 rounded-full" style={{ background: driverColour.get(lane.driverId) }} />
                        <span className="truncate font-medium">{lane.driverName}</span>
                      </div>
                      <div className="text-muted-foreground" dir="ltr">{lane.plate ?? "—"} · {lane.capacity}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border p-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Home className="size-3.5 text-green-600" />{t("legendHome")}</span>
              <span className="inline-flex items-center gap-1"><Building2 className="size-3.5 text-blue-500" />{t("legendArrive")}</span>
              <span className="inline-flex items-center gap-1"><Flag className="size-3.5 text-purple-500" />{t("legendDepart")}</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-0 w-5 border-t-2 border-slate-500" />{t("legendToCentre")}</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-0 w-5 border-t-2 border-dashed border-slate-500" />{t("legendFromCentre")}</span>
            </div>
          </div>

          {/* Unassigned pool */}
          <div
            className="h-fit rounded-xl border border-border bg-card p-3"
            onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-unassign")) e.preventDefault(); }}
            onDrop={onPoolDrop}
          >
            <p className="mb-2 flex items-center gap-1 text-sm font-medium">
              <Users className="size-4 text-orange-500" />{t("unassignedPool", { n: board.pool.length })}
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
                        <span>{te.has(`tripProblem.${p.reason}`) ? te(`tripProblem.${p.reason}`) : t("reasonNotPlanned")}</span>
                        {p.needByMin != null && p.needByMin < 24 * 60 && <span className="tabular-nums" dir="ltr">{minToHHMM(p.needByMin)}</span>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
