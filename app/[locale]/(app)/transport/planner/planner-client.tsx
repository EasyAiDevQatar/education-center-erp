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
} from "lucide-react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { minToHHMM } from "@/lib/planner";
import { AddStopDialog } from "./add-stop-dialog";
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

export function TransportPlannerClient({
  day,
  trips,
  problems,
  drivers,
  legCount,
  centreSet,
}: {
  day: string;
  trips: BoardTrip[];
  problems: ProblemRow[];
  drivers: PlannedDriver[];
  legCount: number;
  centreSet: boolean;
}) {
  const t = useTranslations("transportPlanner");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);

  const proposed = useMemo(() => trips.filter((x) => x.status === "PROPOSED"), [trips]);
  const totalKm = useMemo(
    () => trips.reduce((a, x) => a + x.estimatedKm, 0),
    [trips],
  );
  const emptyKm = useMemo(
    () => trips.reduce((a, x) => a + (x.deadheadKm ?? 0), 0),
    [trips],
  );

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
              <Button
                type="button"
                variant="secondary"
                className="gap-2"
                disabled={pending}
                onClick={() => run(() => approveAll(locale, day))}
              >
                <CheckCheck className="size-4" />
                {t("approveAll", { count: proposed.length })}
              </Button>
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
                <span className="font-medium">{trip.passengerName ?? "—"}</span>
                <span className="text-muted-foreground">
                  {t("stopsCount", { n: trip.stops.length })}
                </span>
                <span className="ms-auto tabular-nums" dir="ltr">
                  {minToHHMM(trip.plannedStartMin)}–{minToHHMM(trip.plannedEndMin)}
                </span>
              </div>

              {/* The chained route: numbered stops with their times, so the
                  coordinator reads the whole journey (home → lesson → centre →
                  … → home) rather than a single leg. */}
              {trip.stops.length > 0 && (
                <ol className="mt-2 space-y-1 border-s-2 border-primary/30 ps-3 text-xs">
                  {trip.stops.map((st) => (
                    <li key={st.seq} className="flex items-baseline gap-2">
                      <span
                        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold tabular-nums text-primary"
                      >
                        {st.seq}
                      </span>
                      <span className="tabular-nums text-muted-foreground" dir="ltr">
                        {minToHHMM(st.plannedMin)}
                      </span>
                      <span className="font-medium">{st.label}</span>
                    </li>
                  ))}
                </ol>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Car className="size-3.5" />
                  {trip.driverName ?? t("noDriver")}
                  {trip.plate && <span dir="ltr">· {trip.plate}</span>}
                </span>
                <span dir="ltr">{t("km", { km: trip.estimatedKm.toFixed(1) })}</span>
                {trip.deadheadKm != null && (
                  <span dir="ltr">{t("emptyKm", { km: trip.deadheadKm.toFixed(1) })}</span>
                )}
                {trip.slackMin != null && (
                  <Badge variant={slackVariant(trip.slackMin)}>
                    {t("slack", { min: trip.slackMin })}
                  </Badge>
                )}
                {trip.autoAllocated && <Badge variant="muted">{t("auto")}</Badge>}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {/* Add / pool a teacher onto a trip that has not left. */}
                {(trip.status === "PROPOSED" || trip.status === "ASSIGNED") && (
                  <AddStopDialog tripId={trip.id} onChanged={() => router.refresh()} />
                )}
                {/* Reassign is available while the trip has not left. */}
                {(trip.status === "PROPOSED" || trip.status === "ASSIGNED") && (
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
                {trip.status === "PROPOSED" && (
                  <>
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
