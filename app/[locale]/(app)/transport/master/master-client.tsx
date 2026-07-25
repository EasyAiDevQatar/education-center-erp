"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Home, Building2, Bus, Hourglass, AlertTriangle, CarFront, GraduationCap, Truck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { axisPct, axisTicks } from "@/lib/transport/axis";
import type { MasterBoard, MasterLane, MasterTrip } from "@/lib/transport/master";

/** Minutes → HH:MM. */
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * The four block types, deliberately far apart in colour.
 *
 * A ride and a lesson must never look alike: reading this board is the whole
 * point, and the previous board's single visual language is what let a
 * teacher's teaching hours pass for idle time.
 */
const BLOCK = {
  home: "bg-emerald-500/85 text-white",
  centre: "bg-sky-500/80 text-white",
  travel: "bg-violet-500/85 text-white",
} as const;

/**
 * Gap styling. A journey nobody planned is a defect and is drawn as one; a
 * long wait is a warning; a genuinely free stretch is quiet on purpose.
 * Making all three look alike is what let a missing ride pass for idle time.
 */
const GAP = {
  TRAVEL_NOT_PLANNED: "bg-destructive/20 ring-1 ring-inset ring-destructive/50",
  WAITING_PROBLEM: "bg-amber-400/30 ring-1 ring-inset ring-amber-500/40",
  WAITING: "bg-amber-400/15",
  FREE: "bg-transparent",
} as const;

/** What the board is currently drawing. Client-side: toggling is instant. */
type Layers = { home: boolean; centre: boolean; trips: boolean; waiting: boolean };

export function MasterClient({ board }: { board: MasterBoard }) {
  const t = useTranslations("transportMaster");
  const locale = useLocale();
  const rtl = locale === "ar";
  const router = useRouter();
  const pathname = usePathname();

  // Centre lessons start hidden: a teacher can have a wall of them and they
  // bury the home visits this planner exists for. Hidden is not ignored —
  // they still draw as a muted occupied band below.
  const [layers, setLayers] = useState<Layers>({
    home: true,
    centre: false,
    trips: true,
    waiting: true,
  });
  const toggle = (k: keyof Layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  /** Teacher rows carry lessons; driver and vehicle rows carry only rides. */
  const byPerson = board.laneKind === "TEACHER";

  /** Physical inline-start side — the axis runs from it. */
  const S = rtl ? "right" : "left";
  const ticks = useMemo(() => axisTicks(board.axis), [board.axis]);
  const pct = (m: number) => axisPct(board.axis, m);

  function go(next: { date?: string; view?: string }) {
    const p = new URLSearchParams();
    p.set("date", next.date ?? board.day);
    const view = next.view ?? board.laneKind;
    if (view !== "TEACHER") p.set("view", view);
    router.push(`${pathname}?${p.toString()}`);
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <Input
          type="date"
          dir="ltr"
          value={board.day}
          onChange={(e) => e.target.value && go({ date: e.target.value })}
          className="w-40"
        />
        {/* One screen, three perspectives. Only what a ROW means changes; the
            segments, gaps and axis below are the same code. */}
        <div className="flex flex-wrap items-center gap-1">
          {(
            [
              ["TEACHER", GraduationCap],
              ["DRIVER", Bus],
              ["VEHICLE", Truck],
            ] as const
          ).map(([kind, Icon]) => (
            <Button
              key={kind}
              type="button"
              variant={board.laneKind === kind ? "default" : "outline"}
              size="sm"
              className="gap-1"
              aria-pressed={board.laneKind === kind}
              onClick={() => go({ view: kind })}
            >
              <Icon className="size-4" />
              {t(`view.${kind}`)}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {/* On a teacher's row these are their lessons; on a driver's or
              vehicle's they are the lessons the rides are FOR, which is what
              tells a dispatcher where a car is heading. */}
          <LayerToggle on={layers.home} onClick={() => toggle("home")} label={t("layerHome")}>
                <Home className="size-4" />
              </LayerToggle>
              <LayerToggle
                on={layers.centre}
                onClick={() => toggle("centre")}
                label={t("layerCentre")}
                count={board.centreSessionCount}
              >
                <Building2 className="size-4" />
          </LayerToggle>
          <LayerToggle on={layers.trips} onClick={() => toggle("trips")} label={t("layerTrips")}>
            <Bus className="size-4" />
          </LayerToggle>
          <LayerToggle on={layers.waiting} onClick={() => toggle("waiting")} label={t("layerWaiting")}>
            <Hourglass className="size-4" />
          </LayerToggle>
        </div>
      </div>

      {/* Timeline */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <div className="min-w-[760px]">
          <p className="border-b border-border p-3 text-sm font-medium">{t("timelineTitle")}</p>

          {/* Hour ruler. Mirrors the dispatch board: the person column comes
              first in reading order, the axis runs away from it. */}
          <div
            /* No flex-row-reverse: our DOM order is [person, timeline], so the
               normal direction already puts the person on the inline-start
               side. The dispatch board reverses because its DOM order is the
               other way round — copying the class blindly put the teacher's
               name at the far LEFT in Arabic, read last, after the bars it
               labels. */
            className="flex items-stretch gap-2 border-b border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground"
          >
            <div className="w-36 shrink-0 font-medium">{t(`colPerson.${board.laneKind}`)}</div>
            <div className="relative flex-1 overflow-hidden">
              {ticks.map((m) => (
                <span
                  key={m}
                  dir="ltr"
                  className={`absolute tabular-nums ${rtl ? "translate-x-1/2" : "-translate-x-1/2"}`}
                  style={{ [S]: `${Math.min(97, Math.max(3, pct(m)))}%` } as React.CSSProperties}
                >
                  {hhmm(m)}
                </span>
              ))}
            </div>
          </div>

          {board.lanes.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            board.lanes.map((lane) => (
              <LaneRow
                  key={lane.id}
                  lane={lane}
                  S={S}
                  pct={pct}
                  layers={layers}
                  byPerson={byPerson}
                />
            ))
          )}

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border p-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Home className="size-3.5 text-emerald-600" />
              {t("legendHome")}
            </span>
            <span className="inline-flex items-center gap-1">
              <Building2 className="size-3.5 text-sky-600" />
              {t("legendCentre")}
            </span>
            <span className="inline-flex items-center gap-1">
              <Bus className="size-3.5 text-violet-600" />
              {t("legendTravel")}
            </span>
            <span className="inline-flex items-center gap-1">
              <Hourglass className="size-3.5 text-amber-600" />
              {t("legendWaiting")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LayerToggle({
  on,
  onClick,
  label,
  count,
  children,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={on ? "default" : "outline"}
      size="sm"
      className="gap-1"
      aria-pressed={on}
      onClick={onClick}
    >
      {children}
      {label}
      {count != null && count > 0 && <span className="tabular-nums opacity-80">({count})</span>}
    </Button>
  );
}

function LaneRow({
  lane,
  S,
  pct,
  layers,
  byPerson,
}: {
  lane: MasterLane;
  S: "left" | "right";
  pct: (m: number) => number;
  layers: Layers;
  byPerson: boolean;
}) {
  const t = useTranslations("transportMaster");

  /** A block spanning a real period, positioned on the axis. */
  const span = (startMin: number, endMin: number) => {
    const a = pct(startMin);
    const b = pct(endMin);
    return {
      [S]: `${Math.min(a, b)}%`,
      width: `${Math.max(Math.abs(b - a), 0.4)}%`,
      minWidth: 26,
    } as React.CSSProperties;
  };

  const hasConflict = lane.sessions.some((s) => s.conflicts);
  const problemGaps = lane.gaps.filter((g) => g.problem);
  /**
   * The lessons this lane's rides are for, once each. A delivery and its
   * return serve the SAME lesson, so drawing them per-trip stacked two
   * identical blocks in the same position.
   */
  const servedLessons = useMemo(() => {
    const byId = new Map<string, MasterTrip["serves"][number] & { who: string | null }>();
    for (const tr of lane.trips) {
      for (const v of tr.serves) {
        if (!byId.has(v.id)) byId.set(v.id, { ...v, who: tr.passengerName });
      }
    }
    return [...byId.values()];
  }, [lane.trips]);

  return (
    <div
      className="flex items-stretch gap-2 border-b border-border px-3 py-2 last:border-b-0"
    >
      {/* Person */}
      <div className="flex w-36 shrink-0 flex-col justify-center text-xs">
        <span className="flex items-center gap-1 truncate font-medium">
          {hasConflict && <AlertTriangle className="size-3.5 shrink-0 text-destructive" />}
          {lane.name}
        </span>
        <span className="text-muted-foreground">
          {/* A driver teaches nothing, so "0 lessons" on their row is noise
              rather than information. */}
          {byPerson
            ? t("laneSummary", { sessions: lane.sessions.length, trips: lane.trips.length })
            : t("laneSummaryTrips", { trips: lane.trips.length })}
        </span>
        {layers.waiting && problemGaps.length > 0 && (
          <span
            className="mt-0.5 inline-flex w-fit items-center gap-1 rounded bg-amber-400/25 px-1 py-0.5 text-[10px] text-amber-800 dark:text-amber-200"
            title={t("gapsHint", { n: problemGaps.length })}
          >
            <Hourglass className="size-3 shrink-0" />
            {t("gapsFlagged", { n: problemGaps.length })}
          </span>
        )}
      </div>

      {/* The day */}
      <div className="relative h-10 flex-1 rounded-md bg-muted/20">
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />

        {/* Classified gaps, drawn first so lessons and rides sit on top. Every
            uncovered stretch gets a reason — a blank row is what hid a missing
            ride as empty space. FREE is deliberately invisible: a quiet
            afternoon needs no decoration, only an explanation on hover. */}
        {layers.waiting &&
          lane.gaps.map((g) => (
            <span
              key={`gap-${g.startMin}`}
              title={t(`gapKind.${g.kind}`, {
                from: hhmm(g.startMin),
                to: hhmm(g.endMin),
                n: g.endMin - g.startMin,
              })}
              className={`absolute inset-y-1.5 cursor-help rounded ${
                g.kind === "TRAVEL_NOT_PLANNED"
                  ? GAP.TRAVEL_NOT_PLANNED
                  : g.kind === "WAITING"
                    ? g.problem
                      ? GAP.WAITING_PROBLEM
                      : GAP.WAITING
                    : GAP.FREE
              }`}
              style={span(g.startMin, g.endMin)}
            >
              {g.kind === "TRAVEL_NOT_PLANNED" && (
                <CarFront className="absolute inset-0 m-auto size-3 text-destructive" />
              )}
            </span>
          ))}

        {/* Occupied at the centre. Drawn only when centre lessons are HIDDEN —
            hidden must not mean ignored, or a fully-booked teacher reads as
            free. Sits behind everything and is never interactive. */}
        {!layers.centre &&
          lane.centreBands.map((b) => (
            <span
              key={`band-${b.startMin}`}
              title={t("centreOccupied", { from: hhmm(b.startMin), to: hhmm(b.endMin) })}
              className="absolute inset-y-1 cursor-help rounded bg-sky-500/15 ring-1 ring-inset ring-sky-500/30"
              style={span(b.startMin, b.endMin)}
            />
          ))}

        {/* What the rides are FOR. Only on driver/vehicle rows — on a teacher's
            row these same lessons are already drawn as her own, and repeating
            them would double every block. Muted, because the lesson is not
            this driver's commitment; it is the reason for theirs. */}
        {!byPerson &&
          servedLessons
              .filter((v) => (v.location === "HOME" ? layers.home : layers.centre))
              .map((v) => (
                <span
                  key={`serves-${v.id}`}
                  title={t("headingTo", {
                    who: v.who ?? v.label,
                    student: v.label,
                    from: hhmm(v.startMin),
                  })}
                  className={`absolute top-1/2 flex h-5 -translate-y-1/2 items-center gap-1 overflow-hidden rounded px-1 text-[10px] opacity-60 ring-1 ring-inset ${
                    v.location === "HOME"
                      ? "bg-emerald-500/25 text-emerald-900 ring-emerald-600/40 dark:text-emerald-100"
                      : "bg-sky-500/25 text-sky-900 ring-sky-600/40 dark:text-sky-100"
                  }`}
                  style={span(v.startMin, v.endMin)}
                >
                  {v.location === "HOME" ? (
                    <Home className="size-3 shrink-0" />
                  ) : (
                    <Building2 className="size-3 shrink-0" />
                  )}
                  <span className="truncate">{v.label}</span>
                </span>
              ))}

        {lane.sessions
          .filter((s) => (s.location === "HOME" ? layers.home : layers.centre))
          .map((s) => (
          <span
            key={s.id}
            title={`${s.label} · ${hhmm(s.startMin)}–${hhmm(s.endMin)}`}
            className={`absolute top-1/2 flex h-6 -translate-y-1/2 items-center gap-1 overflow-hidden rounded px-1 text-[10px] ${
              s.location === "HOME" ? BLOCK.home : BLOCK.centre
            } ${s.conflicts ? "ring-2 ring-destructive" : ""}`}
            style={span(s.startMin, s.endMin)}
          >
            {s.location === "HOME" ? (
              <Home className="size-3 shrink-0" />
            ) : (
              <Building2 className="size-3 shrink-0" />
            )}
            <span className="truncate">{s.label}</span>
          </span>
        ))}

        {layers.trips &&
          lane.trips.map((tr) => (
          <span
            key={tr.id}
            title={[
              `${hhmm(tr.startMin)}–${hhmm(tr.endMin)}`,
              tr.passengerName,
              tr.driverName,
              ...tr.serves.map((v) => t("forLesson", { student: v.label, at: hhmm(v.startMin) })),
            ]
              .filter(Boolean)
              .join(" · ")}
            className={`absolute top-1/2 flex h-3.5 -translate-y-1/2 items-center justify-center rounded-full ${BLOCK.travel} ${
              tr.validationStatus === "INVALID" ? "ring-2 ring-destructive" : ""
            }`}
            style={span(tr.startMin, tr.endMin)}
          >
            <Bus className="size-2.5" />
          </span>
        ))}
      </div>
    </div>
  );
}
