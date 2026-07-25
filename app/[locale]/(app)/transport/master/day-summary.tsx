"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Users,
  TriangleAlert,
  Clock,
  CheckCircle2,
  Car,
  Home,
  Building2,
  Flag,
  Map as MapIcon,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DispatchMap, type MapTrip } from "@/components/dispatch-map";
import { hhmm } from "@/components/transport/timeline";
import type { MasterBoard } from "@/lib/transport/master";

/**
 * The day in numbers, and on a map — below the board it describes.
 *
 * These came from the dispatch page, which had its own reader and so its own
 * arithmetic: its "unassigned" tile once read 0 on a day whose timeline was
 * marking a home visit with no ride at all. Everything here is now counted off
 * the same board drawn above it, so the summary cannot disagree with the thing
 * it summarises.
 */
const PALETTE = ["#2563eb", "#16a34a", "#9333ea", "#dc2626", "#d97706", "#0891b2", "#db2777", "#4f46e5"];

export function DaySummary({ board }: { board: MasterBoard }) {
  const t = useTranslations("transportDispatch");
  const tp = useTranslations("transportPlanner");

  const { stats, stops, mapTrips } = useMemo(() => {
    const trips = board.lanes.flatMap((l) => l.trips);
    // A ride belongs to one lane, but a teacher board draws the same ride on
    // the passenger's row — so count distinct rides, not rows carrying them.
    const seen = new Map(trips.map((x) => [x.id, x]));
    const all = [...seen.values()];

    const near = (lat: number, lng: number) =>
      board.centre != null &&
      Math.abs(lat - board.centre.lat) < 0.0005 &&
      Math.abs(lng - board.centre.lng) < 0.0005;

    let total = 0;
    let homes = 0;
    let toCentre = 0;
    let fromCentre = 0;
    for (const tr of all) {
      if (tr.tripKind === "PICKUP") toCentre++;
      else if (tr.tripKind === "RETURN") fromCentre++;
      for (const st of tr.stops) {
        total++;
        if (!near(st.lat, st.lng)) homes++;
      }
    }

    const completed = all.filter((x) => x.status === "COMPLETED").length;
    const colour = new Map(board.lanes.map((l, i) => [l.id, PALETTE[i % PALETTE.length]]));

    return {
      stats: {
        unassigned: board.pool.length,
        blocked: all.filter((x) => x.validationStatus === "INVALID").length,
        remaining: all.length - completed,
        completed,
        totalTrips: all.length,
      },
      stops: { total, homes, toCentre, fromCentre },
      mapTrips: board.lanes.flatMap<MapTrip>((lane) =>
        lane.trips.map((trip) => ({
          id: trip.id,
          color: colour.get(lane.id) ?? "#2563eb",
          dashed: trip.tripKind === "RETURN",
          geometry: null,
          stops: trip.stops.map((st) => ({
            seq: st.seq,
            lat: st.lat,
            lng: st.lng,
            label: `${st.label} · ${hhmm(st.plannedMin)}`,
          })),
        })),
      ),
    };
  }, [board]);

  const tiles = [
    { label: t("statUnassigned"), value: stats.unassigned, icon: Users, tone: "text-orange-500", bg: "bg-orange-50 dark:bg-orange-950/40" },
    { label: t("statLate"), value: stats.blocked, icon: TriangleAlert, tone: "text-red-500", bg: "bg-red-50 dark:bg-red-950/40" },
    { label: t("statRemaining"), value: stats.remaining, icon: Clock, tone: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-950/40" },
    { label: t("statCompleted"), value: stats.completed, icon: CheckCircle2, tone: "text-green-600", bg: "bg-green-50 dark:bg-green-950/40" },
    { label: t("statTotal"), value: stats.totalTrips, icon: Car, tone: "text-slate-500", bg: "bg-slate-50 dark:bg-slate-900/60" },
  ];

  const segs = [
    { n: stats.unassigned, c: "#f59e0b", label: t("statUnassigned") },
    { n: stats.blocked, c: "#ef4444", label: t("statLate") },
    { n: Math.max(0, stats.remaining - stats.blocked), c: "#3b82f6", label: t("statRemaining") },
    { n: stats.completed, c: "#22c55e", label: t("statCompleted") },
  ];
  const segTotal = Math.max(1, segs.reduce((a, x) => a + x.n, 0));

  const stopTiles = [
    { label: t("stopDepartCentre"), value: stops.fromCentre, icon: Flag, tone: "text-purple-500" },
    { label: t("stopArriveCentre"), value: stops.toCentre, icon: Building2, tone: "text-blue-500" },
    { label: t("stopHomes"), value: stops.homes, icon: Home, tone: "text-green-600" },
    { label: t("stopTotal"), value: stops.total, icon: MapIcon, tone: "text-slate-500" },
  ];

  /** The day as a spreadsheet. The one thing here that exists nowhere else. */
  const exportCsv = () => {
    const rows = [["lane", "trip", "start", "end", "km", "status"]];
    for (const lane of board.lanes)
      for (const tr of lane.trips)
        rows.push([
          lane.name,
          tr.tripKind,
          hhmm(tr.startMin),
          hhmm(tr.endMin),
          String(tr.estimatedKm),
          tr.validationStatus,
        ]);
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `transport-${board.day}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
        {tiles.map((st) => (
          <div key={st.label} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{st.label}</span>
              <span className={`flex size-7 items-center justify-center rounded-lg ${st.bg}`}>
                <st.icon className={`size-4 ${st.tone}`} />
              </span>
            </div>
            <p className={`mt-1 text-3xl font-semibold tabular-nums ${st.tone}`} dir="ltr">
              {st.value}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-sm font-medium">{t("statusSummary")}</p>
          <div className="flex h-6 overflow-hidden rounded-md" dir="ltr">
            {segs.map(
              (sg) =>
                sg.n > 0 && (
                  <div
                    key={sg.label}
                    title={`${sg.label}: ${sg.n}`}
                    className="flex items-center justify-center text-[11px] font-medium text-white"
                    style={{ width: `${(sg.n / segTotal) * 100}%`, background: sg.c }}
                  >
                    {sg.n}
                  </div>
                ),
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {segs.map((sg) => (
              <span key={sg.label} className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-sm" style={{ background: sg.c }} />
                {sg.label}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-sm font-medium">{t("stopsSummary")}</p>
          <div className="grid grid-cols-4 gap-2">
            {stopTiles.map((tile) => (
              <div key={tile.label} className="rounded-lg bg-muted/40 p-2 text-center">
                <tile.icon className={`mx-auto size-4 ${tile.tone}`} />
                <p className="mt-1 text-lg font-semibold tabular-nums" dir="ltr">
                  {tile.value}
                </p>
                <p className="text-[10px] leading-tight text-muted-foreground">{tile.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {mapTrips.length > 0 && (
        <DispatchMap trips={mapTrips} centre={board.centre} centreLabel={t("centre")} height={360} />
      )}

      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={exportCsv}>
          <Download className="size-3.5" />
          {t("export")}
        </Button>
      </div>
      <span className="sr-only">{tp("title")}</span>
    </div>
  );
}
