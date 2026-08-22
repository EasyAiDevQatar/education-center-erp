"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  ClipboardCheck,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { type DayAxis } from "@/lib/transport/axis";
import {
  TimelineFrame,
  TimelineHeader,
  TimelineRow,
  useTrack,
  hhmm,
} from "@/components/transport/timeline";
import { hoursOf, proposedResize, proposedTimes } from "@/lib/transport/drag-lock";
import type { MasterBoard, MasterLane, MasterSession, MasterTrip } from "@/lib/transport/master";
import { ImpactDialog } from "./impact-dialog";
import { RideAssignDialog } from "./ride-assign-dialog";
import { DaySummary } from "./day-summary";
import { SessionDialog, type PriceMatrix } from "../../sessions/session-dialog";
import { saveSession } from "../../sessions/actions";
import { assignToDriver, previewAssignAll, unassignPassenger } from "./ride-actions";
import { Users, GripVertical, Undo2 as UndoIcon } from "lucide-react";

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
  // Same violet as a ride, because it IS travel — dashed and hollow because it
  // is not ours to plan. Red would say "fix me" about someone already sorted.
  TRAVEL_OWN_CAR: "bg-violet-500/10 border border-dashed border-violet-500/60",
  WAITING_PROBLEM: "bg-amber-400/30 ring-1 ring-inset ring-amber-500/40",
  WAITING: "bg-amber-400/15",
  FREE: "bg-transparent",
} as const;

/**
 * Everything the booking dialog needs, loaded only for someone who can book.
 * Null for a viewer, which is also what makes the legend chips undraggable
 * for them — the permission and the affordance come from one fact.
 */
export type BookingOptions = {
  currency: string;
  students: {
    id: string;
    name: string;
    gradeLevelId: string | null;
    gradeYear: number | null;
    teacherIds: string[];
    studyLocation: "CENTER" | "HOME";
  }[];
  teachers: { id: string; label: string }[];
  levels: { id: string; label: string }[];
  matrix: PriceMatrix;
  subjects: { id: string; label: string }[];
  teacherSubjectIds: Record<string, string[]>;
};

/** A legend chip dropped on a lane, waiting for its dialog. */
type Dropped = {
  chip: "home" | "centre" | "travel";
  laneId: string;
  laneName: string;
  startMin: number;
};

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
  /** True when the gesture changed how LONG the lesson is, not just when. */
  resized: boolean;
};

export function MasterClient({
  board,
  booking,
}: {
  board: MasterBoard;
  booking: BookingOptions | null;
}) {
  const t = useTranslations("transportMaster");
  // The pool's words already exist on the dispatch board; borrowed rather than
  // copied, so the two never drift into describing the same thing differently.
  const td = useTranslations("transportDispatch");
  const tpl = useTranslations("transportPlanner");
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
  const [reviewing, setReviewing] = useState(false);
  /** The unplanned-travel gap the user clicked, if any. */
  /** Every lock reason on the board today, counted, worst-first. */
  const lockSummary = useMemo(() => {
    const n = new Map<string, number>();
    for (const lane of board.lanes) {
      for (const s of lane.sessions) {
        if (s.lockReason) n.set(s.lockReason, (n.get(s.lockReason) ?? 0) + 1);
      }
    }
    return [...n.entries()]
      .map(([reason, count]) => ({ reason, n: count }))
      .sort((a, b) => b.n - a.n);
  }, [board.lanes]);

  // Dragging a pool card: which passenger, and how each driver would fare.
  // The halo is the honest part — a lane that lights up red is one where the
  // ride would be blocked, said before the drop rather than after it.
  const [carrying, setCarrying] = useState<string | null>(null);
  const [halo, setHalo] = useState<Map<string, string>>(new Map());
  const [assignErr, setAssignErr] = useState<string | null>(null);
  /** The last assignment made here, so it can be taken back in one click. */
  const [lastAssign, setLastAssign] = useState<string | null>(null);

  // Narrowing, not hiding: a filtered-out ride is still on the board's data,
  // so the pool count and the lock summary keep telling the truth about the
  // whole day rather than about the current view of it.
  const [driverFilter, setDriverFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [exceptionsOnly, setExceptionsOnly] = useState(false);

  const visibleLanes = useMemo(() => {
    const tripPasses = (tr: MasterTrip) =>
      (directionFilter === "all" || tr.tripKind === directionFilter) &&
      (statusFilter === "all" || tr.validationStatus === statusFilter) &&
      (!exceptionsOnly || tr.validationStatus !== "VALID");
    return board.lanes
      .filter((l) => driverFilter === "all" || l.id === driverFilter)
      .map((l) => {
        const trips = l.trips.filter(tripPasses);
        // Same object when nothing was removed, so an unfiltered board does
        // not re-render every row for nothing.
        return trips.length === l.trips.length ? l : { ...l, trips };
      });
  }, [board.lanes, driverFilter, directionFilter, statusFilter, exceptionsOnly]);
  const [, startAssign] = useTransition();

  const [dropped, setDropped] = useState<Dropped | null>(null);
  const [assigning, setAssigning] = useState<{
    laneId: string;
    who: string;
    startMin: number;
    endMin: number;
  } | null>(null);
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

      {/* Only on a driver or vehicle board: filtering a teacher's day by
          "direction of travel" is not a question anybody asks. */}
      {!byPerson && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Select
            value={driverFilter}
            onChange={(e) => setDriverFilter(e.target.value)}
            className="h-8 w-44 text-xs"
          >
            <option value="all">{td(board.laneKind === "DRIVER" ? "allDrivers" : "allStatuses")}</option>
            {board.lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
          <Select
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value)}
            className="h-8 w-40 text-xs"
          >
            <option value="all">{td("allDirections")}</option>
            <option value="PICKUP">{tpl("tripKind.PICKUP")}</option>
            <option value="RETURN">{tpl("tripKind.RETURN")}</option>
          </Select>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 w-36 text-xs"
          >
            <option value="all">{td("allStatuses")}</option>
            <option value="INVALID">{tpl("validation.INVALID")}</option>
            <option value="WARNING">{tpl("validation.WARNING")}</option>
            <option value="VALID">{tpl("validation.VALID")}</option>
          </Select>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={exceptionsOnly}
              onChange={(e) => setExceptionsOnly(e.target.checked)}
            />
            {td("exceptionsOnly")}
          </label>
        </div>
      )}

      {/* A refused assignment says so where the pool is, not in a console. */}
      {assignErr && (
        <p className="rounded-xl border border-destructive bg-destructive/10 p-2.5 text-sm text-destructive">
          {t.has(`assignErr.${assignErr}`) ? t(`assignErr.${assignErr}`) : assignErr}
        </p>
      )}

      {/* The work still to be handed out, beside the rows that could take it.
          Only on the driver view: on a teacher board these same people are the
          passengers, and "assign حنان to حنان" is not a sentence. */}
      {board.laneKind === "DRIVER" && board.canDrag && (
        <div
          className="rounded-xl border border-border bg-card p-3"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(UNASSIGN_MIME)) e.preventDefault();
          }}
          onDrop={(e) => {
            const key = e.dataTransfer.getData(UNASSIGN_MIME);
            if (!key) return;
            e.preventDefault();
            startAssign(async () => {
              const res = await unassignPassenger(locale, board.day, key);
              setAssignErr(res.error ?? null);
              if (!res.error) setLastAssign(null);
              router.refresh();
            });
          }}
        >
          <p className="mb-2 flex items-center gap-1 text-sm font-medium">
            <Users className="size-4 text-orange-500" />
            {td("unassignedPool", { n: board.pool.length })}
            {/* Taking back the last assignment, without having to find which
                ride it became. Dragging a bar back here does the same thing
                for any of them. */}
            {lastAssign && (
              <button
                type="button"
                onClick={() =>
                  startAssign(async () => {
                    const res = await unassignPassenger(locale, board.day, lastAssign);
                    setAssignErr(res.error ?? null);
                    if (!res.error) setLastAssign(null);
                    router.refresh();
                  })
                }
                className="ms-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs font-normal hover:bg-accent"
              >
                <UndoIcon className="size-3.5" />
                {td("undo")}
              </button>
            )}
          </p>
          {board.pool.length === 0 ? (
            <p className="text-xs text-muted-foreground">{td("poolEmpty")}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {board.pool.map((p) => (
                <li
                  key={p.passengerKey}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(PASSENGER_MIME, p.passengerKey);
                    e.dataTransfer.effectAllowed = "move";
                    setCarrying(p.passengerKey);
                    // Ask, the moment the card leaves the pool, which lanes
                    // could actually take it. Read-only.
                    previewAssignAll(locale, board.day, p.passengerKey).then((r) => {
                      if (r.ok)
                        setHalo(
                          new Map(r.drivers.map((d) => [d.driverId, d.feasible ? d.status : "INVALID"])),
                        );
                    });
                  }}
                  onDragEnd={() => {
                    setCarrying(null);
                    setHalo(new Map());
                  }}
                  className={`flex cursor-grab items-start gap-1 rounded-md border border-border border-s-2 border-s-orange-500 p-2 text-xs active:cursor-grabbing ${
                    carrying === p.passengerKey ? "opacity-50" : ""
                  }`}
                >
                  <GripVertical className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.passengerName}</span>
                    <span className="text-muted-foreground" dir="ltr">
                      {p.needByMin != null && p.needByMin < 24 * 60 ? hhmm(p.needByMin) : "—"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {carrying && <p className="mt-2 text-xs text-muted-foreground">{td("dragHint")}</p>}
        </div>
      )}

      {/* Why anything is locked, said out loud.
          The padlocks were correct and completely unexplained: the reason
          lived in a title attribute, so the board showed a wall of locks and
          left you to discover that hovering was the way to ask. A day's worth
          of reasons is a short list; here it is, counted. */}
      {board.canDrag && lockSummary.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-muted/30 p-2.5 text-xs">
          <span className="inline-flex items-center gap-1 font-medium">
            <Lock className="size-3.5 shrink-0" />
            {t("lockedSummary", { n: lockSummary.reduce((a, x) => a + x.n, 0) })}
          </span>
          {lockSummary.map((x) => (
            <span key={x.reason} className="text-muted-foreground">
              {t(`lock.${x.reason}`)} ({x.n})
            </span>
          ))}
        </div>
      )}

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
          <div className="ms-auto flex items-center gap-2">
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
            {/* The note used to promise a next step. This is it: the proposal
                becomes a question about what it would cost, and only an
                explicit answer to that question writes anything. */}
            <Button type="button" size="sm" className="gap-1" onClick={() => setReviewing(true)}>
              <ClipboardCheck className="size-4" />
              {t("previewAction")}
            </Button>
          </div>
        </div>
      )}

      {/* A dropped chip is a request for the form that thing needs — the same
          booking dialog the rest of the app uses, with what the drop already
          knew filled in: whose row, which day, what time, and whether the
          lesson is at home or at the centre. */}
      {dropped && booking && dropped.chip !== "travel" && (
        <SessionDialog
          open
          onOpenChange={(v) => !v && setDropped(null)}
          title={t(dropped.chip === "home" ? "legendHome" : "legendCentre")}
          action={saveSession.bind(null, locale, null)}
          students={booking.students}
          teachers={booking.teachers}
          levels={booking.levels}
          matrix={booking.matrix}
          subjects={booking.subjects}
          teacherSubjectIds={booking.teacherSubjectIds}
          currency={booking.currency}
          defaultDate={board.day}
          defaultTime={hhmm(dropped.startMin)}
          defaultTeacherId={dropped.laneId}
          defaultLocation={dropped.chip === "home" ? "HOME" : "CENTER"}
          onSaved={() => {
            setDropped(null);
            router.refresh();
          }}
        />
      )}

      {/* Travel is not a thing you create from nothing: it is a ride for
          somebody, which is the same question the red gap asks. */}
      {dropped && dropped.chip === "travel" && (
        <RideAssignDialog
          open
          onOpenChange={(v) => !v && setDropped(null)}
          day={board.day}
          passengerKey={`TEACHER:${dropped.laneId}`}
          who={dropped.laneName}
          from={dropped.startMin}
          to={dropped.startMin}
        />
      )}

      {assigning && (
        <RideAssignDialog
          open
          onOpenChange={(v) => !v && setAssigning(null)}
          day={board.day}
          passengerKey={
            assigning.laneId.includes(":") ? assigning.laneId : `TEACHER:${assigning.laneId}`
          }
          who={assigning.who}
          {...(assigning.endMin > assigning.startMin
            ? { from: assigning.startMin, to: assigning.endMin }
            : {})}
          // Accepting the suggestion hands it to the board's own
          // preview→confirm rather than writing behind a second door.
          onFix={(fix) => {
            const lesson = board.lanes
              .flatMap((l) => l.sessions.map((x) => ({ lane: l, s: x })))
              .find(({ s }) => s.id === fix.sessionId);
            setAssigning(null);
            setProposal({
              laneId: lesson?.lane.id ?? "",
              laneName: lesson?.lane.name ?? "",
              sessionId: fix.sessionId,
              label: lesson?.s.label ?? "",
              fromStartMin: fix.fromStartMin,
              fromEndMin: lesson ? lesson.s.endMin : fix.fromStartMin,
              startMin: fix.toStartMin,
              endMin: fix.toStartMin + (lesson ? lesson.s.endMin - lesson.s.startMin : 60),
              resized: false,
            });
            setReviewing(true);
          }}
        />
      )}

      {/* Mounted only while it is open, so each review starts from a blank
          answer rather than flashing the previous one. */}
      {proposal && reviewing && (
        <ImpactDialog
          open
          onOpenChange={setReviewing}
          move={{
            day: board.day,
            sessionId: proposal.sessionId,
            fromStartMin: proposal.fromStartMin,
            toStartMin: proposal.startMin,
            // Only sent when the length actually changed, so a plain move
            // stays a one-field write with no money in it.
            ...(proposal.resized
              ? { toHours: hoursOf(proposal.startMin, proposal.endMin) }
              : {}),
          }}
          // The lesson is where the board now says it is, so the proposal has
          // served its purpose. Leaving it up would draw a saved lesson as an
          // unsaved change and offer to undo something already done.
          onApplied={() => setProposal(null)}
          onRetime={(startMin) =>
            setProposal((p) =>
              p ? { ...p, startMin, endMin: startMin + (p.endMin - p.startMin) } : p,
            )
          }
        />
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
            {/* The legend became a palette. Each chip is the thing it labels,
                so dragging one onto a row says "put one of these here" and the
                board answers with the form that thing needs.

                No chip for waiting: waiting is not an entity, it is the shape
                of the space left over, and a chip that created nothing would be
                a lie in the one place the board is meant to be literal. */}
            <LegendChip kind="home" draggable={!!booking && byPerson} label={t("legendHome")}>
              <Home className="size-3.5 text-emerald-600" />
            </LegendChip>
            <LegendChip kind="centre" draggable={!!booking && byPerson} label={t("legendCentre")}>
              <Building2 className="size-3.5 text-sky-600" />
            </LegendChip>
            <LegendChip kind="travel" draggable={!!booking && byPerson} label={t("legendTravel")}>
              <Bus className="size-3.5 text-violet-600" />
            </LegendChip>
            <span className="inline-flex items-center gap-1">
              <Hourglass className="size-3.5 text-amber-600" />
              {t("legendWaiting")}
            </span>
            {/* Not a chip: you cannot hand somebody their own car. It appears
                by itself on the rows of teachers who drive, which is the whole
                point — nobody should have to know why that row has no red. */}
            <span className="inline-flex items-center gap-1">
              <CarFront className="size-3.5 text-violet-600" />
              {t("legendOwnCar")}
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

        {visibleLanes.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          visibleLanes.map((lane) => (
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
              // Only a teacher lane names a passenger; a driver's row shows the
              // same red stretch but there is nobody on it to give a ride to.
              // Only a driver's row can take a passenger — a teacher's row is
              // the person being carried, not the one doing the carrying.
              onDropPassenger={
                board.canDrag && board.laneKind === "DRIVER"
                  ? (passengerKey) =>
                      startAssign(async () => {
                        setCarrying(null);
                        setHalo(new Map());
                        const res = await assignToDriver(locale, board.day, passengerKey, lane.id);
                        setAssignErr(res.error ?? null);
                        if (!res.error) setLastAssign(passengerKey);
                        router.refresh();
                      })
                  : undefined
              }
              halo={halo.get(lane.id)}
              onOpenRide={
                board.canDrag
                  ? (passengerKey, w) =>
                      setAssigning({ laneId: passengerKey, who: w, startMin: 0, endMin: 0 })
                  : undefined
              }
              onDropChip={
                booking && byPerson
                  ? (chip, startMin) =>
                      setDropped({ chip, laneId: lane.id, laneName: lane.name, startMin })
                  : undefined
              }
              onAssignGap={
                byPerson
                  ? (g) =>
                      setAssigning({
                        laneId: lane.id,
                        who: lane.name,
                        startMin: g.startMin,
                        endMin: g.endMin,
                      })
                  : undefined
              }
            />
          ))
        )}
      </TimelineFrame>

      {/* The day in numbers and on a map, BELOW the board they describe —
          counted off that same board, so a summary can never disagree with the
          thing it summarises. */}
      <DaySummary board={board} />
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

/**
 * A grab strip on one temporal edge of a lesson.
 *
 * Its own component so the gesture it starts stays out of the row's render
 * path — and so the two edges are declared as two things rather than a loop
 * over a direction, which is how a left/right assumption sneaks back in.
 */
/** Our own types, so a stray file drag can never look like one of ours. */
const CHIP_MIME = "application/x-master-chip";
const PASSENGER_MIME = "application/x-assign";
const UNASSIGN_MIME = "application/x-unassign";

function LegendChip({
  kind,
  draggable,
  label,
  children,
}: {
  kind: "home" | "centre" | "travel";
  draggable: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("transportMaster");
  return (
    <span
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(CHIP_MIME, kind);
        e.dataTransfer.effectAllowed = "copy";
      }}
      title={draggable ? t("chipDragHint") : undefined}
      className={`inline-flex items-center gap-1 rounded px-1 py-0.5 ${
        draggable ? "cursor-grab active:cursor-grabbing hover:bg-accent" : ""
      }`}
    >
      {children}
      {label}
    </span>
  );
}

function ResizeHandle({
  style,
  onGrab,
}: {
  style: React.CSSProperties;
  onGrab: (e: React.PointerEvent) => void;
}) {
  return (
    <span
      aria-hidden
      onPointerDown={onGrab}
      style={style}
      className="absolute inset-y-0 z-10 cursor-ew-resize touch-none opacity-0 transition group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100 after:absolute after:inset-y-1 after:start-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-white/80"
    />
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
  onAssignGap,
  onDropChip,
  onDropPassenger,
  onOpenRide,
  halo,
}: {
  lane: MasterLane;
  layers: Layers;
  byPerson: boolean;
  axis: DayAxis;
  rtl: boolean;
  canDrag: boolean;
  proposal: Proposal | null;
  /** Present only where the gap belongs to someone who can be given a ride. */
  onAssignGap?: (g: { startMin: number; endMin: number }) => void;
  /** Present only for a user who may create things on this row. */
  onDropChip?: (chip: "home" | "centre" | "travel", startMin: number) => void;
  /** Present only on a driver's row, for a user who may assign. */
  onDropPassenger?: (passengerKey: string) => void;
  /** Open a ride's details — who drives it, and the chance to change that. */
  onOpenRide?: (passengerKey: string, who: string) => void;
  /** The verdict this lane would give the card currently being dragged. */
  halo?: string;
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

  // Measured rather than read from the ref during render: a ref is not a
  // rendering input, and the handles have to appear when the board is resized.
  const [trackW, setTrackW] = useState(0);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setTrackW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // `latest` is the whole reason this is a ref and not just state: React may
  // batch the last pointermove together with pointerup, so a handler reading
  // `drag` on release sees the position from one move ago. On a quick flick
  // that lands the proposal short of the ghost the user was looking at.
  const dragRef = useRef<
    | {
        /** Which gesture is running. Decided once, at pointerdown. */
        kind: "move" | "from" | "to";
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

  const startDrag = (
    e: React.PointerEvent,
    s: MasterSession,
    kind: "move" | "from" | "to" = "move",
  ) => {
    if (!canDrag || s.lockReason || e.button !== 0 || !e.isPrimary) return;
    // A handle press must never also start a move. Stopping it here makes that
    // structural rather than a guess about where the pointer landed.
    if (kind !== "move") e.stopPropagation();
    // The observed width, not a fresh ref read. Still bailing on zero: an
    // unmeasured track would turn a few pixels of touch jitter into a
    // full-day fling.
    const width = trackW;
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
      kind,
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
    const delta = deltaMinutes(e.clientX - d.x0, d.width);
    const next =
      d.kind === "move"
        ? proposedTimes({ startMin: d.startMin, endMin: d.endMin }, delta, axis)
        : proposedResize({ startMin: d.startMin, endMin: d.endMin }, d.kind, delta, axis);
    d.latest = next;
    setDrag({ sessionId: d.sessionId, ...next });
  };

  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    const moved = d.latest;
    // Both edges, because a resize leaves the start exactly where it was and a
    // start-only comparison would throw every one of them away.
    if (moved.startMin === d.startMin && moved.endMin === d.endMin) return;
    onPropose({
      laneId: lane.id,
      laneName: lane.name,
      sessionId: d.sessionId,
      label: d.label,
      fromStartMin: d.startMin,
      fromEndMin: d.endMin,
      startMin: moved.startMin,
      endMin: moved.endMin,
      resized: moved.endMin - moved.startMin !== d.endMin - d.startMin,
    });
  };

  /** Keyboard equivalent: the board must be usable without a pointer. */
  const nudge = (s: MasterSession, steps: number, edge?: "from" | "to") => {
    if (!canDrag || s.lockReason) return;
    onPropose((prev) => {
      const base =
        prev?.sessionId === s.id
          ? { startMin: prev.startMin, endMin: prev.endMin }
          : { startMin: s.startMin, endMin: s.endMin };
      const next = edge
        ? proposedResize(base, edge, steps * 15, axis)
        : proposedTimes(base, steps * 15, axis);
      // Back to exactly where it started, at its original length: that is not
      // a proposal, it is a change of mind.
      if (next.startMin === s.startMin && next.endMin === s.endMin) return null;
      return {
        laneId: lane.id,
        laneName: lane.name,
        sessionId: s.id,
        label: s.label,
        fromStartMin: s.startMin,
        fromEndMin: s.endMin,
        ...next,
        resized: next.endMin - next.startMin !== s.endMin - s.startMin,
      };
    });
  };

  /** The one route from a minute to a position, shared with the dispatch board. */
  const { place: span, edge, minuteAt, pctPerMin } = useTrack();


  /**
   * Is there room for two handles and still something to grab in between?
   *
   * A quarter-hour lesson is a few pixels wide on a nine-hour axis; two grab
   * strips would leave it with no body, so the whole block would resize when
   * the user meant to move it. Those stay move-only — and still resizable from
   * the keyboard, which does not care how wide anything is.
   */
  const wideEnough = (s: { startMin: number; endMin: number }) =>
    trackW > 0 && ((s.endMin - s.startMin) * pctPerMin * trackW) / 100 >= 48;

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
      trackClassName={
        halo === undefined
          ? ""
          : halo === "INVALID"
            ? "ring-2 ring-inset ring-destructive/60"
            : halo === "WARNING"
              ? "ring-2 ring-inset ring-amber-500/60"
              : "ring-2 ring-inset ring-green-500/70"
      }
      trackProps={
        onDropChip || onDropPassenger
          ? {
              onDragOver: (e) => {
                const ty = e.dataTransfer.types;
                if (
                  (onDropChip && ty.includes(CHIP_MIME)) ||
                  (onDropPassenger && ty.includes(PASSENGER_MIME))
                )
                  e.preventDefault();
              },
              onDrop: (e) => {
                const who = e.dataTransfer.getData(PASSENGER_MIME);
                if (who && onDropPassenger) {
                  e.preventDefault();
                  onDropPassenger(who);
                  return;
                }
                const chip = e.dataTransfer.getData(CHIP_MIME);
                if (!onDropChip || (chip !== "home" && chip !== "centre" && chip !== "travel"))
                  return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                // The drop lands on a TIME, read back off the axis by the same
                // helper that put everything else on it.
                onDropChip(chip, minuteAt(e.clientX, rect));
              },
            }
          : undefined
      }
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
              role={g.kind === "TRAVEL_NOT_PLANNED" && onAssignGap ? "button" : undefined}
              tabIndex={g.kind === "TRAVEL_NOT_PLANNED" && onAssignGap ? 0 : undefined}
              onClick={
                g.kind === "TRAVEL_NOT_PLANNED" && onAssignGap
                  ? () => onAssignGap({ startMin: g.startMin, endMin: g.endMin })
                  : undefined
              }
              onKeyDown={
                g.kind === "TRAVEL_NOT_PLANNED" && onAssignGap
                  ? (e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      onAssignGap({ startMin: g.startMin, endMin: g.endMin });
                    }
                  : undefined
              }
              title={[
                t(`gapKind.${g.kind}`, {
                  from: hhmm(g.startMin),
                  to: hhmm(g.endMin),
                  n: g.endMin - g.startMin,
                }),
                g.kind === "TRAVEL_NOT_PLANNED" && onAssignGap ? t("gapAssignHint") : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              className={`absolute inset-y-1.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                g.kind === "TRAVEL_NOT_PLANNED" && onAssignGap
                  ? "cursor-pointer hover:brightness-110"
                  : "cursor-help"
              } ${GAP[g.kind === "WAITING" && g.problem ? "WAITING_PROBLEM" : g.kind]}`}
              style={span(g.startMin, g.endMin)}
            >
              {(g.kind === "TRAVEL_NOT_PLANNED" || g.kind === "TRAVEL_OWN_CAR") && (
                <CarFront
                  className={`absolute inset-0 m-auto size-3 ${
                    g.kind === "TRAVEL_OWN_CAR"
                      ? "text-violet-600 dark:text-violet-400"
                      : "text-destructive"
                  }`}
                />
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
                  // Shift stretches the later edge, Alt the earlier one; plain
                  // arrows move the whole lesson. All three mirrored in Arabic.
                  const edge = e.shiftKey ? "to" : e.altKey ? "from" : undefined;
                  if (e.key === "ArrowRight") nudge(s, rtl ? -1 : 1, edge);
                  else if (e.key === "ArrowLeft") nudge(s, rtl ? 1 : -1, edge);
                  else if (e.key === "Escape") onPropose(null);
                  else return;
                  e.preventDefault();
                }}
                className={`group absolute top-1/2 flex h-6 -translate-y-1/2 items-center gap-1 rounded px-1 text-[10px] outline-none ring-offset-1 focus-visible:ring-2 focus-visible:ring-ring ${
                  s.location === "HOME" ? BLOCK.home : BLOCK.centre
                } ${s.conflicts ? "ring-2 ring-destructive" : ""} ${
                  movable ? "cursor-grab touch-none active:cursor-grabbing" : locked ? "cursor-not-allowed" : ""
                } ${drag?.sessionId === s.id || proposal?.sessionId === s.id ? "opacity-40" : ""}`}
                style={span(s.startMin, s.endMin)}
              >
                {movable && wideEnough(s) && (
                  <>
                    <ResizeHandle style={edge("from")} onGrab={(e) => startDrag(e, s, "from")} />
                    <ResizeHandle style={edge("to")} onGrab={(e) => startDrag(e, s, "to")} />
                  </>
                )}
                {locked ? (
                  <Lock className="size-3 shrink-0" />
                ) : s.location === "HOME" ? (
                  <Home className="size-3 shrink-0" />
                ) : (
                  <Building2 className="size-3 shrink-0" />
                )}
                <span className="truncate">{s.label}</span>
                {/* A lesson wants a ride to it and a ride on from it. The one
                    that is missing is marked on the side it is missing from,
                    so the gap reads as a direction rather than a warning. */}
                {s.rideIn === false && (
                  <span
                    title={t("missingRideIn")}
                    style={edge("from", 6)}
                    className="absolute inset-y-0 bg-destructive"
                  />
                )}
                {s.rideOut === false && (
                  <span
                    title={t("missingRideOut")}
                    style={edge("to", 6)}
                    className="absolute inset-y-0 bg-destructive"
                  />
                )}
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
          lane.trips.map((tr) => {
          const backKey = !byPerson && tr.linkGroup ? tr.linkGroup.replace(/^day:/, "") : null;
          // Every ride is openable, on any perspective: the question "who is
          // driving this and can it be someone else" belongs to the bar you
          // are looking at, not to a different screen.
          const who = tr.linkGroup ? tr.linkGroup.replace(/^day:/, "") : null;
          return (
          <span
            key={tr.id}
            draggable={!!backKey}
            onDragStart={(e) => {
              if (!backKey) return;
              e.dataTransfer.setData(UNASSIGN_MIME, backKey);
              e.dataTransfer.effectAllowed = "move";
            }}
            role={who && onOpenRide ? "button" : undefined}
            tabIndex={who && onOpenRide ? 0 : undefined}
            onClick={who && onOpenRide ? () => onOpenRide(who, tr.passengerName ?? lane.name) : undefined}
            onKeyDown={
              who && onOpenRide
                ? (e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    onOpenRide(who, tr.passengerName ?? lane.name);
                  }
                : undefined
            }
            title={[
              `${hhmm(tr.startMin)}–${hhmm(tr.endMin)}`,
              tr.passengerName,
              tr.driverName,
              ...tr.serves.map((v) => t("forLesson", { student: v.label, at: hhmm(v.startMin) })),
            ]
              .filter(Boolean)
              .join(" · ")}
            className={`absolute top-1/2 flex h-3.5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring ${BLOCK.travel} ${
              tr.validationStatus === "INVALID" ? "ring-2 ring-destructive" : ""
            }`}
            style={span(tr.startMin, tr.endMin)}
          >
            <Bus className="size-2.5" />
          </span>
          );
        })}
    </TimelineRow>
  );
}
