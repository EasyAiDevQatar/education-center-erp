"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import {
  Home,
  Building2,
  Bus,
  Hourglass,
  AlertTriangle,
  CarFront,
  GraduationCap,
  Truck,
  Lock,
  Undo2,
  MoveHorizontal,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { type DayAxis } from "@/lib/transport/axis";
import {
  TimelineFrame,
  TimelineHeader,
  TimelineRow,
  useTrack,
  hhmm,
} from "@/components/transport/timeline";
import { proposedTimes } from "@/lib/transport/drag-lock";
import type { MasterBoard, MasterLane, MasterSession, MasterTrip } from "@/lib/transport/master";

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

/**
 * A move the user has drawn but nobody has agreed to.
 *
 * Deliberately not a mutation. Dragging a lesson re-times a car, a driver and
 * possibly a second lesson at the other end of the day; committing that on
 * mouse-up would be a write nobody reviewed. So the gesture produces a
 * PROPOSAL — visible, reversible, saved nowhere — and the next step gives it a
 * preview and a confirm button.
 */
type Proposal = {
  laneId: string;
  laneName: string;
  sessionId: string;
  label: string;
  fromStartMin: number;
  fromEndMin: number;
  startMin: number;
  endMin: number;
};

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

  const [proposal, setProposal] = useState<Proposal | null>(null);
  /** Teacher rows carry lessons; driver and vehicle rows carry only rides. */
  const byPerson = board.laneKind === "TEACHER";

  function go(next: { date?: string; view?: string }) {
    // A proposal belongs to one day and one perspective; carrying it across a
    // navigation would leave a ghost pointing at a lesson no longer on screen.
    setProposal(null);
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

      {/* An unsaved proposal. Loud enough that nobody walks away believing the
          day was changed, and undoable in one click. */}
      {proposal && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-500/50 bg-amber-400/10 p-3 text-sm">
          <span className="inline-flex items-center gap-1 font-medium">
            <MoveHorizontal className="size-4 shrink-0 text-amber-600" />
            {t("proposalTitle")}
          </span>
          <span dir="auto">
            {t("proposalMove", {
              student: proposal.label,
              teacher: proposal.laneName,
              fromRange: `${hhmm(proposal.fromStartMin)}–${hhmm(proposal.fromEndMin)}`,
              toRange: `${hhmm(proposal.startMin)}–${hhmm(proposal.endMin)}`,
            })}
          </span>
          <span className="text-muted-foreground">{t("proposalNote")}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => setProposal(null)}
          >
            <Undo2 className="size-4" />
            {t("proposalCancel")}
          </Button>
        </div>
      )}

      {/* The timeline. Frame, ruler and row geometry are the shared component's
          business now — this board and the dispatch board cannot draw the same
          day two different widths. */}
      <TimelineFrame
        axis={board.axis}
        rtl={rtl}
        title={t("timelineTitle")}
        legend={
          <>
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
            {board.canDrag && byPerson && (
              <span className="inline-flex items-center gap-1">
                <MoveHorizontal className="size-3.5" />
                {t("dragHint")}
              </span>
            )}
          </>
        }
      >
        <TimelineHeader label={t(`colPerson.${board.laneKind}`)} />

        {board.lanes.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          board.lanes.map((lane) => (
            <LaneRow
              key={lane.id}
              lane={lane}
              layers={layers}
              byPerson={byPerson}
              axis={board.axis}
              rtl={rtl}
              canDrag={board.canDrag}
              proposal={proposal?.laneId === lane.id ? proposal : null}
              onPropose={setProposal}
            />
          ))
        )}
      </TimelineFrame>
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
  layers,
  byPerson,
  axis,
  rtl,
  canDrag,
  proposal,
  onPropose,
}: {
  lane: MasterLane;
  layers: Layers;
  byPerson: boolean;
  axis: DayAxis;
  rtl: boolean;
  canDrag: boolean;
  proposal: Proposal | null;
  /**
   * The setter itself, not a plain callback: a nudge is computed FROM the
   * current proposal, and two arrow presses in the same tick would otherwise
   * both read the pre-render value and the second would undo the first.
   */
  onPropose: React.Dispatch<React.SetStateAction<Proposal | null>>;
}) {
  const t = useTranslations("transportMaster");

  // --- dragging a lesson to a new time -----------------------------------
  //
  // Pointer events rather than HTML5 drag-and-drop: the ghost has to follow
  // the finger on a tablet in the office, and the native API gives no useful
  // position on touch. Nothing here writes; the gesture ends in a proposal.
  const trackRef = useRef<HTMLDivElement>(null);
  // `latest` is the whole reason this is a ref and not just state: React may
  // batch the last pointermove together with pointerup, so a handler reading
  // `drag` on release sees the position from one move ago. On a quick flick
  // that lands the proposal short of the ghost the user was looking at.
  const dragRef = useRef<
    | {
        sessionId: string;
        label: string;
        startMin: number;
        endMin: number;
        x0: number;
        width: number;
        latest: { startMin: number; endMin: number };
      }
    | null
  >(null);
  const [drag, setDrag] = useState<{ sessionId: string; startMin: number; endMin: number } | null>(
    null,
  );

  /** Pixels → minutes, mirrored in Arabic where the axis runs the other way. */
  const deltaMinutes = (dx: number, width: number) =>
    ((rtl ? -dx : dx) / Math.max(1, width)) * (axis.maxMin - axis.minMin);

  const startDrag = (e: React.PointerEvent, s: MasterSession) => {
    if (!canDrag || s.lockReason || e.button !== 0) return;
    const width = trackRef.current?.clientWidth ?? 0;
    if (!width) return;
    e.preventDefault();
    // Capture so the ghost keeps following a pointer dragged off the block —
    // and off the row. Not every browser will grant it; the drag still works
    // while the pointer stays over the block, so a refusal is not fatal.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released, or capture unsupported */
    }
    dragRef.current = {
      sessionId: s.id,
      label: s.label,
      startMin: s.startMin,
      endMin: s.endMin,
      x0: e.clientX,
      width,
      latest: { startMin: s.startMin, endMin: s.endMin },
    };
    setDrag({ sessionId: s.id, startMin: s.startMin, endMin: s.endMin });
  };

  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const next = proposedTimes(
      { startMin: d.startMin, endMin: d.endMin },
      deltaMinutes(e.clientX - d.x0, d.width),
      axis,
    );
    d.latest = next;
    setDrag({ sessionId: d.sessionId, ...next });
  };

  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    const moved = d.latest;
    // A click that happened to land on a lesson is not a proposal.
    if (moved.startMin === d.startMin) return;
    onPropose({
      laneId: lane.id,
      laneName: lane.name,
      sessionId: d.sessionId,
      label: d.label,
      fromStartMin: d.startMin,
      fromEndMin: d.endMin,
      startMin: moved.startMin,
      endMin: moved.endMin,
    });
  };

  /** Keyboard equivalent: the board must be usable without a pointer. */
  const nudge = (s: MasterSession, steps: number) => {
    if (!canDrag || s.lockReason) return;
    onPropose((prev) => {
      const base =
        prev?.sessionId === s.id
          ? { startMin: prev.startMin, endMin: prev.endMin }
          : { startMin: s.startMin, endMin: s.endMin };
      const next = proposedTimes(base, steps * 15, axis);
      // Nudged back to where it started: that is not a proposal, it is a
      // change of mind.
      if (next.startMin === s.startMin) return null;
      return {
        laneId: lane.id,
        laneName: lane.name,
        sessionId: s.id,
        label: s.label,
        fromStartMin: s.startMin,
        fromEndMin: s.endMin,
        ...next,
      };
    });
  };

  /** The one route from a minute to a position, shared with the dispatch board. */
  const { place: span } = useTrack();

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
    <TimelineRow
      trackRef={trackRef}
      leading={
        <>
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
        </>
      }
    >
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
          .map((s) => {
            const movable = canDrag && !s.lockReason;
            // A lock is only worth drawing for someone who could otherwise
            // move it. For a read-only viewer every lesson is "locked", and
            // padlocking the whole board says nothing.
            const locked = canDrag && !!s.lockReason;
            return (
              <span
                key={s.id}
                role={movable ? "button" : undefined}
                tabIndex={movable ? 0 : undefined}
                aria-label={movable ? t("dragAria", { student: s.label }) : undefined}
                title={[
                  `${s.label} · ${hhmm(s.startMin)}–${hhmm(s.endMin)}`,
                  locked ? t(`lock.${s.lockReason}`) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                onPointerDown={(e) => startDrag(e, s)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={(e) => {
                  if (!movable) return;
                  // Arrow keys follow what the user SEES: in Arabic the axis
                  // runs right-to-left, so "left" is later.
                  if (e.key === "ArrowRight") nudge(s, rtl ? -1 : 1);
                  else if (e.key === "ArrowLeft") nudge(s, rtl ? 1 : -1);
                  else if (e.key === "Escape") onPropose(null);
                  else return;
                  e.preventDefault();
                }}
                className={`absolute top-1/2 flex h-6 -translate-y-1/2 items-center gap-1 overflow-hidden rounded px-1 text-[10px] outline-none ring-offset-1 focus-visible:ring-2 focus-visible:ring-ring ${
                  s.location === "HOME" ? BLOCK.home : BLOCK.centre
                } ${s.conflicts ? "ring-2 ring-destructive" : ""} ${
                  movable ? "cursor-grab touch-none active:cursor-grabbing" : locked ? "cursor-not-allowed" : ""
                } ${drag?.sessionId === s.id || proposal?.sessionId === s.id ? "opacity-40" : ""}`}
                style={span(s.startMin, s.endMin)}
              >
                {locked ? (
                  <Lock className="size-3 shrink-0" />
                ) : s.location === "HOME" ? (
                  <Home className="size-3 shrink-0" />
                ) : (
                  <Building2 className="size-3 shrink-0" />
                )}
                <span className="truncate">{s.label}</span>
              </span>
            );
          })}

        {/* The ghost: where the lesson WOULD go. Dashed and hollow on purpose
            — it is a drawing, not a booking, and must never be mistaken for
            one. Live while the pointer is down, and it stays put afterwards so
            the proposal can be read and undone. */}
        {(() => {
          const g = drag ?? (proposal ? { startMin: proposal.startMin, endMin: proposal.endMin } : null);
          if (!g) return null;
          return (
            <span
              className="pointer-events-none absolute top-1/2 flex h-6 -translate-y-1/2 items-center justify-center rounded border-2 border-dashed border-amber-500 bg-amber-400/25 px-1 text-[10px] font-medium text-amber-900 dark:text-amber-100"
              style={span(g.startMin, g.endMin)}
            >
              <span dir="ltr" className="tabular-nums">
                {hhmm(g.startMin)}
              </span>
            </span>
          );
        })()}

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
    </TimelineRow>
  );
}
