"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Home, Building2, Bus, Hourglass, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { axisPct, axisTicks } from "@/lib/transport/axis";
import type { MasterBoard, MasterLane } from "@/lib/transport/master";

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
  waiting: "bg-amber-400/30 text-amber-900 dark:text-amber-200",
} as const;

export function MasterClient({
  board,
  includeCentre,
}: {
  board: MasterBoard;
  includeCentre: boolean;
}) {
  const t = useTranslations("transportMaster");
  const locale = useLocale();
  const rtl = locale === "ar";
  const router = useRouter();
  const pathname = usePathname();

  /** Physical inline-start side — the axis runs from it. */
  const S = rtl ? "right" : "left";
  const ticks = useMemo(() => axisTicks(board.axis), [board.axis]);
  const pct = (m: number) => axisPct(board.axis, m);

  function go(next: { date?: string; centre?: boolean }) {
    const p = new URLSearchParams();
    p.set("date", next.date ?? board.day);
    if (next.centre ?? includeCentre) p.set("centre", "1");
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
        <Button
          type="button"
          variant={includeCentre ? "default" : "outline"}
          size="sm"
          className="gap-1"
          onClick={() => go({ centre: !includeCentre })}
        >
          <Building2 className="size-4" />
          {t("toggleCentre")}
          {board.centreSessionCount > 0 && (
            <span className="tabular-nums opacity-80">({board.centreSessionCount})</span>
          )}
        </Button>
      </div>

      {/* Timeline */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <div className="min-w-[760px]">
          <p className="border-b border-border p-3 text-sm font-medium">{t("timelineTitle")}</p>

          {/* Hour ruler. Mirrors the dispatch board: the person column comes
              first in reading order, the axis runs away from it. */}
          <div
            className={`flex items-stretch gap-2 border-b border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground ${
              rtl ? "flex-row-reverse" : ""
            }`}
          >
            <div className="w-36 shrink-0 font-medium">{t("colPerson")}</div>
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
              <LaneRow key={lane.id} lane={lane} rtl={rtl} S={S} pct={pct} />
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

function LaneRow({
  lane,
  rtl,
  S,
  pct,
}: {
  lane: MasterLane;
  rtl: boolean;
  S: "left" | "right";
  pct: (m: number) => number;
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

  return (
    <div
      className={`flex items-stretch gap-2 border-b border-border px-3 py-2 last:border-b-0 ${
        rtl ? "flex-row-reverse" : ""
      }`}
    >
      {/* Person */}
      <div className="flex w-36 shrink-0 flex-col justify-center text-xs">
        <span className="flex items-center gap-1 truncate font-medium">
          {hasConflict && <AlertTriangle className="size-3.5 shrink-0 text-destructive" />}
          {lane.name}
        </span>
        <span className="text-muted-foreground">
          {t("laneSummary", { sessions: lane.sessions.length, trips: lane.trips.length })}
        </span>
      </div>

      {/* The day */}
      <div className="relative h-10 flex-1 rounded-md bg-muted/20">
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />

        {lane.sessions.map((s) => (
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

        {lane.trips.map((tr) => (
          <span
            key={tr.id}
            title={`${hhmm(tr.startMin)}–${hhmm(tr.endMin)}${tr.driverName ? " · " + tr.driverName : ""}`}
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
