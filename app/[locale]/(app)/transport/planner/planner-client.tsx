"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Wand2,
  Check,
  CheckCheck,
  X,
  TriangleAlert,
  Trash2,
  Car,
  Clock,
  Route,
  Sparkles,
  Map as MapIcon,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Ruler,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { minToHHMM } from "@/lib/planner";
import { AddStopDialog } from "./add-stop-dialog";
import { NewTripDialog } from "./new-trip-dialog";
import { OverrideDialog } from "./override-dialog";
import { TripMiniMap } from "@/components/trip-mini-map";
import type { BoardTrip, PlannedDriver } from "@/lib/transport/trip-data";
import {
  generateTrips,
  approveAll,
  aiBriefing,
  setTripStatus,
  reassignTrip,
  clearProposals,
} from "./actions";

export type ProblemRow = {
  kind: "unassigned" | "skipped";
  reason: string;
  passengerName: string;
  fromLabel: string;
  toLabel: string;
  dueMin: number | null;
};

function statusVariant(status: string) {
  if (status === "PROPOSED") return "warning" as const;
  if (status === "ASSIGNED") return "default" as const;
  if (status === "STARTED") return "success" as const;
  if (status === "COMPLETED") return "success" as const;
  return "muted" as const;
}

/** Tight slack is the number a coordinator actually needs to see. */
function slackVariant(slack: number | null) {
  if (slack == null) return "muted" as const;
  if (slack < 0) return "destructive" as const;
  if (slack <= 5) return "warning" as const;
  return "success" as const;
}

/** Validation status → badge variant + icon (spec §29). */
function validationVariant(status: string) {
  if (status === "INVALID") return "destructive" as const;
  if (status === "WARNING") return "warning" as const;
  return "success" as const;
}
const ValidationIcon = ({ status }: { status: string }) =>
  status === "INVALID" ? (
    <ShieldX className="size-3.5" />
  ) : status === "WARNING" ? (
    <ShieldAlert className="size-3.5" />
  ) : (
    <ShieldCheck className="size-3.5" />
  );

export function TransportPlannerClient({
  day,
  trips,
  problems,
  drivers,
  legCount,
  centreSet,
  canOverride,
}: {
  day: string;
  trips: BoardTrip[];
  problems: ProblemRow[];
  drivers: PlannedDriver[];
  legCount: number;
  centreSet: boolean;
  canOverride: boolean;
}) {
  const t = useTranslations("transportPlanner");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [mapOpen, setMapOpen] = useState<Set<string>>(new Set());
  const toggleMap = (id: string) =>
    setMapOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const [reasonsOpen, setReasonsOpen] = useState<Set<string>>(new Set());
  const toggleReasons = (id: string) =>
    setReasonsOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const [note, setNote] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);

  const proposed = useMemo(() => trips.filter((x) => x.status === "PROPOSED"), [trips]);
  // "Approve all" only ever approves routes the validator cleared — reflect that
  // in the count so a board of blocked routes doesn't offer a misleading action.
  const approvable = useMemo(
    () => proposed.filter((x) => x.validationStatus !== "INVALID"),
    [proposed],
  );
  const totalKm = useMemo(
    () => trips.reduce((a, x) => a + x.estimatedKm, 0),
    [trips],
  );
  const emptyKm = useMemo(
    () => trips.reduce((a, x) => a + (x.deadheadKm ?? 0), 0),
    [trips],
  );
  const vCounts = useMemo(() => {
    let invalid = 0;
    let warning = 0;
    let fallback = 0;
    for (const x of trips) {
      if (x.validationStatus === "INVALID") invalid++;
      else if (x.validationStatus === "WARNING") warning++;
      if (x.fallbackUsed) fallback++;
    }
    return { invalid, warning, fallback };
  }, [trips]);

  const go = (d: string) => router.push(`${pathname}?date=${d}`);
  const shiftDay = (delta: number) => {
    const dt = new Date(`${day}T00:00:00.000Z`);
    dt.setUTCDate(dt.getUTCDate() + delta);
    go(dt.toISOString().slice(0, 10));
  };

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const res = await fn();
      setNote(res.error ? tc.has(`errors.${res.error}`) ? tc(`errors.${res.error}`) : tc("errors.invalid") : null);
      router.refresh();
    });

  return (
    <>
      {/* Day bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <Button type="button" variant="outline" size="sm" onClick={() => shiftDay(-1)}>
          ‹
        </Button>
        <Input
          type="date"
          dir="ltr"
          value={day}
          onChange={(e) => e.target.value && go(e.target.value)}
          className="w-40"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => shiftDay(1)}>
          ›
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => shiftDay(0)}>
          {t("today")}
        </Button>

        <div className="ms-auto flex flex-wrap gap-2">
          <NewTripDialog day={day} drivers={drivers} onCreated={() => router.refresh()} />
          <Button
            type="button"
            className="gap-2"
            disabled={pending || !centreSet}
            onClick={() => run(() => generateTrips(locale, day))}
          >
            <Wand2 className="size-4" />
            {t("generate")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={briefBusy}
            onClick={() => {
              setBriefBusy(true);
              setBriefing(null);
              aiBriefing(locale, day)
                .then((r) => setBriefing(r.ok && r.message ? r.message : t("aiBriefingFailed")))
                .finally(() => setBriefBusy(false));
            }}
          >
            <Sparkles className="size-4" />
            {briefBusy ? t("aiBriefingBusy") : t("aiBriefing")}
          </Button>
          {proposed.length > 0 && (
            <>
              {approvable.length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  className="gap-2"
                  disabled={pending}
                  onClick={() => run(() => approveAll(locale, day))}
                >
                  <CheckCheck className="size-4" />
                  {t("approveAll", { count: approvable.length })}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                disabled={pending}
                onClick={() => run(() => clearProposals(locale, day))}
              >
                <Trash2 className="size-4" />
                {t("clearProposals")}
              </Button>
            </>
          )}
        </div>
        {briefing && (
          <div className="mt-2 w-full whitespace-pre-wrap rounded-md border border-border bg-accent/50 p-3 text-sm">
            {briefing}
          </div>
        )}
      </div>

      {!centreSet && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert className="size-4" />
            {t("noCentre")}
          </p>
        </div>
      )}

      {note && (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          {note}
        </p>
      )}

      {/* Day summary */}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        {[
          { label: t("statLegs"), value: String(legCount), icon: Route },
          { label: t("statTrips"), value: String(trips.length), icon: Car },
          { label: t("statKm"), value: totalKm.toFixed(1), icon: Route },
          { label: t("statEmptyKm"), value: emptyKm.toFixed(1), icon: Clock },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="text-xl font-semibold tabular-nums" dir="ltr">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Validation roll-up (spec §30): how many trips are blocked, need a
          look, or ran on the straight-line estimate. Only shown when relevant. */}
      {(vCounts.invalid > 0 || vCounts.warning > 0 || vCounts.fallback > 0) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {vCounts.invalid > 0 && (
            <Badge variant="destructive" className="gap-1">
              <ShieldX className="size-3.5" />
              {t("statInvalid", { n: vCounts.invalid })}
            </Badge>
          )}
          {vCounts.warning > 0 && (
            <Badge variant="warning" className="gap-1">
              <ShieldAlert className="size-3.5" />
              {t("statWarning", { n: vCounts.warning })}
            </Badge>
          )}
          {vCounts.fallback > 0 && (
            <Badge variant="muted" className="gap-1">
              <Ruler className="size-3.5" />
              {t("statFallback", { n: vCounts.fallback })}
            </Badge>
          )}
        </div>
      )}

      {/* Problems — a ride nobody can make is never silently dropped. */}
      {problems.length > 0 && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium">
            <TriangleAlert className="size-4" />
            {t("problems", { count: problems.length })}
          </p>
          <ul className="space-y-1 text-sm">
            {problems.map((p, i) => (
              <li key={`${p.passengerName}-${i}`} className="flex flex-wrap items-center gap-2">
                <Badge variant="destructive">{te(`tripProblem.${p.reason}`)}</Badge>
                <span className="font-medium">{p.passengerName}</span>
                <span className="text-muted-foreground">
                  {p.fromLabel}
                  {p.toLabel ? ` → ${p.toLabel}` : ""}
                </span>
                {p.dueMin != null && (
                  <span className="tabular-nums text-muted-foreground" dir="ltr">
                    {minToHHMM(p.dueMin)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The board */}
      {trips.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <div className="space-y-2">
          {trips.map((trip) => (
            <div
              key={trip.id}
              className="rounded-lg border border-border bg-card p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusVariant(trip.status)}>
                  {te(`tripStatus.${trip.status}`)}
                </Badge>
                {/* Validation verdict (spec §29) — always shown, colour is
                    secondary to the icon + label so it reads without colour. */}
                <Badge variant={validationVariant(trip.validationStatus)} className="gap-1">
                  <ValidationIcon status={trip.validationStatus} />
                  {t(`validation.${trip.validationStatus}`)}
                </Badge>
                {/* Direction after the pickup/return split (C4). */}
                {trip.tripKind && (
                  <Badge
                    variant={trip.tripKind === "PICKUP" ? "default" : trip.tripKind === "RETURN" ? "success" : "muted"}
                    className="gap-1"
                  >
                    {trip.tripKind === "PICKUP" ? (
                      <ArrowDownToLine className="size-3.5" />
                    ) : trip.tripKind === "RETURN" ? (
                      <ArrowUpFromLine className="size-3.5" />
                    ) : null}
                    {t(`tripKind.${trip.tripKind}`)}
                  </Badge>
                )}
                {/* Estimated (straight-line) vs road-routed indicator (spec §28). */}
                <Badge variant="muted" className="gap-1">
                  <Ruler className="size-3.5" />
                  {trip.fallbackUsed ? t("estimated") : t("roadRouted")}
                </Badge>
                <span className="font-medium">{trip.passengerName ?? "—"}</span>
                <span className="text-muted-foreground">
                  {t("stopsCount", { n: trip.stops.length })}
                </span>
                <span className="ms-auto tabular-nums" dir="ltr">
                  {minToHHMM(trip.plannedStartMin)}–{minToHHMM(trip.plannedEndMin)}
                </span>
              </div>

              {/* Why a trip needs review or is blocked — the backend's own
                  validation messages, never re-derived on the client (spec §27). */}
              {trip.validationMessages.length > 0 && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => toggleReasons(trip.id)}
                    className={`inline-flex items-center gap-1 text-xs hover:underline ${
                      trip.validationStatus === "INVALID"
                        ? "text-destructive"
                        : "text-amber-600 dark:text-amber-500"
                    }`}
                  >
                    <TriangleAlert className="size-3.5" />
                    {reasonsOpen.has(trip.id)
                      ? t("hideReasons")
                      : t("showReasons", { n: trip.validationMessages.length })}
                  </button>
                  {reasonsOpen.has(trip.id) && (
                    <ul className="mt-1 space-y-1 ps-1 text-xs">
                      {trip.validationMessages.map((m, i) => {
                        const who =
                          m.stopSeq != null
                            ? trip.stops.find((s) => s.seq === m.stopSeq)?.passengerName ?? null
                            : null;
                        return (
                        <li key={i} className="flex items-start gap-1.5">
                          <Badge
                            variant={m.level === "INVALID" ? "destructive" : "warning"}
                            className="mt-0.5 shrink-0"
                          >
                            {t(`validation.${m.level}`)}
                          </Badge>
                          <span>
                            {who && <span className="font-medium">{who}: </span>}
                            <span className="font-medium">
                              {tc.has(`validationCode.${m.code}`)
                                ? tc(`validationCode.${m.code}`)
                                : m.code}
                            </span>
                            {m.text && (
                              <span className="ms-1 text-muted-foreground" dir="ltr">
                                — {m.text}
                              </span>
                            )}
                          </span>
                        </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              {/* The chained route: numbered stops with their times, so the
                  coordinator reads the whole journey (home → lesson → centre →
                  … → home) rather than a single leg. */}
              {trip.stops.length > 0 && (
                <ol className="mt-2 space-y-1 border-s-2 border-primary/30 ps-3 text-xs">
                  {trip.stops.map((st) => (
                    <li key={st.seq} className="flex flex-col gap-0.5">
                      <div className="flex items-baseline gap-2">
                      <span
                        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold tabular-nums text-primary"
                      >
                        {st.seq}
                      </span>
                      <span className="tabular-nums text-muted-foreground" dir="ltr">
                        {minToHHMM(st.plannedMin)}
                      </span>
                      {/* Pickup vs drop-off, labelled not just coloured (spec §29). */}
                      <span
                        className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold uppercase ${
                          st.kind === "PICKUP"
                            ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                            : "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                        }`}
                      >
                        {st.kind === "PICKUP" ? (
                          <ArrowUpFromLine className="size-2.5" />
                        ) : (
                          <ArrowDownToLine className="size-2.5" />
                        )}
                        {st.kind === "PICKUP" ? t("pickup") : t("dropoff")}
                      </span>
                      <span className="font-medium">{st.label}</span>
                      {/* The lesson's own start (green) and end (red) — what the
                          driver must hit — as small raised buttons. */}
                      {st.sessionStartMin != null && (
                        <span className="ms-auto flex shrink-0 items-center gap-1" dir="ltr">
                          <span className="rounded-md border-b-2 border-green-800 bg-green-600 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white shadow-sm">
                            {minToHHMM(st.sessionStartMin)}
                          </span>
                          {st.sessionEndMin != null && (
                            <span className="rounded-md border-b-2 border-red-800 bg-red-600 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white shadow-sm">
                              {minToHHMM(st.sessionEndMin)}
                            </span>
                          )}
                        </span>
                      )}
                      </div>
                      {/* Labelled per-passenger timing (spec §27-28): the
                          dispatcher reads the meaning, never infers it from the
                          coloured chips alone. */}
                      {st.timing && (
                        <div className="ms-6 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                          {st.timing.dir === "TO_LESSON" ? (
                            <>
                              <span>{t("tSession")}: <span dir="ltr">{minToHHMM(st.timing.sessionStartMin)}–{minToHHMM(st.timing.sessionEndMin)}</span></span>
                              <span>{t("tRequiredArrival")}: <span dir="ltr">{minToHHMM(st.timing.requiredArrivalMin)}</span></span>
                              <span>{t("tPlannedArrival")}: <span dir="ltr">{minToHHMM(st.timing.plannedArrivalMin)}</span></span>
                              {st.timing.delayMin > 0 ? (
                                <span className="font-medium text-destructive">{t("tDelay")}: {st.timing.delayMin} {t("min")}</span>
                              ) : (
                                <span className="text-green-700 dark:text-green-400">{t("tArrivalMargin")}: {st.timing.marginMin} {t("min")}</span>
                              )}
                            </>
                          ) : (
                            <>
                              <span>{t("tSessionEnd")}: <span dir="ltr">{minToHHMM(st.timing.sessionEndMin)}</span></span>
                              <span>{t("tReadyFrom")}: <span dir="ltr">{minToHHMM(st.timing.readyFromMin)}</span></span>
                              <span>{t("tPlannedDepart")}: <span dir="ltr">{minToHHMM(st.timing.plannedDepartMin)}</span></span>
                              {st.timing.earlyDepartMin > 0 ? (
                                <span className="font-medium text-destructive">{t("tEarlyDepart")}: {st.timing.earlyDepartMin} {t("min")}</span>
                              ) : (
                                <span>{t("tWait")}: {st.timing.waitMin} {t("min")}</span>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}

              {/* Route map — mounted only while open, so a busy board stays
                  light (each card renders its own Leaflet only on demand). */}
              {trip.stops.length > 1 && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => toggleMap(trip.id)}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <MapIcon className="size-3.5" />
                    {mapOpen.has(trip.id) ? t("hideMap") : t("routeMap")}
                  </button>
                  {mapOpen.has(trip.id) && (
                    <div className="mt-2 max-w-xl">
                      <TripMiniMap stops={trip.stops} height={180} geometry={trip.routeGeometry} />
                    </div>
                  )}
                </div>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Car className="size-3.5" />
                  {trip.driverName ?? t("noDriver")}
                  {trip.plate && <span dir="ltr">· {trip.plate}</span>}
                </span>
                {trip.passengerCount > 0 && (
                  <span>{t("passengers", { n: trip.passengerCount })}</span>
                )}
                <span dir="ltr">{t("km", { km: trip.estimatedKm.toFixed(1) })}</span>
                <span dir="ltr">
                  {t("durationHM", {
                    h: Math.floor(trip.estimatedMin / 60),
                    m: trip.estimatedMin % 60,
                  })}
                </span>
                {trip.deadheadKm != null && (
                  <span dir="ltr">{t("emptyKm", { km: trip.deadheadKm.toFixed(1) })}</span>
                )}
                {trip.slackMin != null && (
                  <Badge variant={slackVariant(trip.slackMin)} title={t("tightestMarginHint")}>
                    {t("tightestMargin", { min: trip.slackMin })}
                  </Badge>
                )}
                {trip.autoAllocated && <Badge variant="muted">{t("auto")}</Badge>}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {/* Add / pool a teacher onto a trip that has not left. */}
                {(trip.status === "PROPOSED" || trip.status === "PLANNED" || trip.status === "ASSIGNED") && (
                  <AddStopDialog tripId={trip.id} onChanged={() => router.refresh()} />
                )}
                {/* Reassign is available while the trip has not left. */}
                {(trip.status === "PROPOSED" || trip.status === "PLANNED" || trip.status === "ASSIGNED") && (
                  <Select
                    aria-label={t("reassign")}
                    value={trip.driverId ?? ""}
                    disabled={pending}
                    onChange={(e) =>
                      e.target.value && run(() => reassignTrip(locale, trip.id, e.target.value))
                    }
                    className="h-8 w-44 text-xs"
                  >
                    <option value="">{t("noDriver")}</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {d.plate ? ` · ${d.plate}` : ""}
                      </option>
                    ))}
                  </Select>
                )}
                {(trip.status === "PROPOSED" || trip.status === "PLANNED") && (
                  <>
                    {trip.validationStatus === "INVALID" ? (
                      <>
                        {/* A blocked route cannot be approved normally. The
                            primary action is to look at why; only an admin sees
                            the audited exceptional-approval path. */}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={() => toggleReasons(trip.id)}
                        >
                          <TriangleAlert className="size-3.5" />
                          {t("reviewIssues")}
                        </Button>
                        {canOverride && (
                          <OverrideDialog tripId={trip.id} onDone={() => router.refresh()} />
                        )}
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        className="gap-1"
                        disabled={pending}
                        onClick={() => run(() => setTripStatus(locale, trip.id, "ASSIGNED"))}
                      >
                        <Check className="size-3.5" />
                        {t("approve")}
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      disabled={pending}
                      onClick={() => run(() => setTripStatus(locale, trip.id, "CANCELLED"))}
                    >
                      <X className="size-3.5" />
                      {t("reject")}
                    </Button>
                  </>
                )}
                {trip.status === "ASSIGNED" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => run(() => setTripStatus(locale, trip.id, "STARTED"))}
                  >
                    {t("start")}
                  </Button>
                )}
                {trip.status === "STARTED" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => run(() => setTripStatus(locale, trip.id, "COMPLETED"))}
                  >
                    {t("complete")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
