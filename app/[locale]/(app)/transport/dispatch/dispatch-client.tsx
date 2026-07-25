"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Users, TriangleAlert, Clock, CheckCircle2, Car,
  Home, Building2, Flag, RefreshCw, Download, Map as MapIcon, Table2,
} from "lucide-react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { minToHHMM } from "@/lib/planner";
import { DispatchMap, type MapTrip } from "@/components/dispatch-map";
import type { DispatchBoard } from "@/lib/transport/dispatch";
import type { MasterBoard } from "@/lib/transport/master";
import { MasterClient } from "../master/master-client";

const DRIVER_PALETTE = ["#2563eb", "#16a34a", "#9333ea", "#dc2626", "#d97706", "#0891b2", "#db2777", "#4f46e5"];

export function DispatchClient({
  board,
  master,
}: {
  board: DispatchBoard;
  master: MasterBoard;
}) {
  const t = useTranslations("transportDispatch");
  const tp = useTranslations("transportPlanner");
  const router = useRouter();
  const pathname = usePathname();

  const kindLabel = (k: string | null) => (k ? tp(`tripKind.${k}`) : "—");
  const go = (d: string) => router.push(`${pathname}?date=${d}`);
  const shiftDay = (delta: number) => {
    const dt = new Date(`${board.day}T00:00:00.000Z`);
    dt.setUTCDate(dt.getUTCDate() + delta);
    go(dt.toISOString().slice(0, 10));
  };

  // --- state --------------------------------------------------------------
  const [mapOnly, setMapOnly] = useState(false);

  /** The day as a spreadsheet. The one thing here that exists nowhere else. */
  const exportCsv = () => {
    const rows = [["driver", "vehicle", "trip", "start", "end", "km", "status"]];
    for (const lane of board.lanes)
      for (const tr of lane.trips)
        rows.push([
          lane.driverName,
          lane.plate ?? "",
          kindLabel(tr.tripKind),
          minToHHMM(tr.plannedStartMin),
          minToHHMM(tr.plannedEndMin),
          String(tr.estimatedKm),
          tr.validationStatus,
        ]);
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `dispatch-${board.day}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const s = board.stats;

  const stats = [
    // The master board's definition, not this reader's. "Unassigned" here used
    // to mean "the allocator could not place it", which is a smaller set than
    // "nobody is driving it" — so this tile read 0 on a day whose timeline was
    // visibly marking a home visit with no ride. Two numbers for one question
    // is worse than either answer.
    { label: t("statUnassigned"), value: master.pool.length, icon: Users, tone: "text-orange-500", bg: "bg-orange-50 dark:bg-orange-950/40" },
    { label: t("statLate"), value: s.blocked, icon: TriangleAlert, tone: "text-red-500", bg: "bg-red-50 dark:bg-red-950/40" },
    { label: t("statRemaining"), value: s.remaining, icon: Clock, tone: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-950/40" },
    { label: t("statCompleted"), value: s.completed, icon: CheckCircle2, tone: "text-green-600", bg: "bg-green-50 dark:bg-green-950/40" },
    { label: t("statTotal"), value: s.totalTrips, icon: Car, tone: "text-slate-500", bg: "bg-slate-50 dark:bg-slate-900/60" },
  ];

  // Status-summary bar segments (disjoint-ish, matching the mockup's four bands).
  const segs = [
    { n: master.pool.length, c: "#f59e0b", label: t("statUnassigned") },
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

  return (
    <>
      {/* Day bar with export / refresh + map/table toggle */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={exportCsv}>
          <Download className="size-3.5" />{t("export")}
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => router.refresh()}>
          <RefreshCw className="size-3.5" />{t("refresh")}
        </Button>
        <div className="ms-2 flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => shiftDay(-1)}>‹</Button>
          <Input type="date" dir="ltr" value={board.day} onChange={(e) => e.target.value && go(e.target.value)} className="w-36" />
          <Button type="button" variant="outline" size="sm" onClick={() => shiftDay(1)}>›</Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => shiftDay(0)}>{t("today")}</Button>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Button type="button" variant={mapOnly ? "outline" : "secondary"} size="sm" className="gap-1" onClick={() => setMapOnly(false)}>
            <Table2 className="size-3.5" />{t("mapAndTable")}
          </Button>
          <Button type="button" variant={mapOnly ? "secondary" : "outline"} size="sm" className="gap-1" onClick={() => setMapOnly(true)}>
            <MapIcon className="size-3.5" />{t("mapOnly")}
          </Button>
        </div>
      </div>

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

      {!mapOnly && (
        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          {/* Map first, with the unassigned pool beside it — the pool is what a
              coordinator acts on, so it belongs in sight rather than below a
              board they have to scroll past. Placement is explicit so the DOM
              order (map, board, pool) can stay as it is. */}
          {mapTrips.length > 0 && (
            <div className="lg:col-start-1 lg:row-start-1">
              <DispatchMap trips={mapTrips} centre={board.centre} centreLabel={t("centre")} height={360} />
            </div>
          )}
          {/* Not "the same component" any more — the same BOARD.
              A driver's day was being drawn twice from one reader, which is one
              drawing too many: the copy here could only ever fall behind the
              page whose whole job is that drawing. Everything the master
              planner does on a driver row — the lessons each ride is for,
              waiting, travel nobody planned, the pool, assign, undo, the
              filters — arrives with it, and none of it had to be ported. */}
          <div className="lg:col-span-2 lg:row-start-2">
            <MasterClient board={master} booking={null} />
          </div>

        </div>
      )}
    </>
  );
}
