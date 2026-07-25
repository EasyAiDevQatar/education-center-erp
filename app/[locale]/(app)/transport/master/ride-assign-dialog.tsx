"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Ban, CarFront, Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { hhmm } from "@/components/transport/timeline";
import { driverOptionsFor, type DriverOption } from "./actions";
import { assignLegToDriver, legOptionsFor, type LegOption } from "../dispatch/actions";

/**
 * The one gap with an obvious next action.
 *
 * A red stretch says the person has to be somewhere else and no ride is
 * planned. Every other gap kind is a fact to read; this one is a job to do, so
 * it is the only one that is clickable — and clicking it offers the drivers
 * who could actually make it, in that order, rather than a list to guess from.
 */
export function RideAssignDialog({
  open,
  onOpenChange,
  day,
  passengerKey,
  who,
  from,
  to,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  day: string;
  /** `TEACHER:<id>` — a teacher lane's id IS the teacher. */
  passengerKey: string;
  who: string;
  /** The gap's window — absent when opened from a ride rather than a gap. */
  from?: number;
  to?: number;
}) {
  const t = useTranslations("transportMaster");
  const tp = useTranslations("transportPlanner");
  const locale = useLocale();
  const router = useRouter();

  // Two steps, in the order the question is actually asked: WHICH journey,
  // then who drives it. Assigning every journey a passenger has because they
  // share a name is how one drop produced a ride out and a ride back that
  // nobody chose.
  const [legs, setLegs] = useState<LegOption[] | null>(null);
  const [legId, setLegId] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<DriverOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Derived, not stored: "still waiting" is exactly "the answer has not
  // arrived", and a second copy of that fact can only ever disagree with it.
  const loading = error == null && (legId ? drivers === null : legs === null);
  const [saving, startSaving] = useTransition();
  /** Bumped after a successful assign so the journey list re-reads itself. */
  const [round, setRound] = useState(0);

  // Step 1: which journeys need a driver.
  useEffect(() => {
    let live = true;
    legOptionsFor(locale, day, passengerKey)
      .then((res) => {
        if (!live) return;
        if ("error" in res && res.error) setError(res.error);
        else setLegs((res as { legs: LegOption[] }).legs);
      });
    return () => {
      live = false;
    };
  }, [locale, day, passengerKey, round]);

  // Step 2: who can drive the one that was picked.
  useEffect(() => {
    if (!legId) return;
    let live = true;
    driverOptionsFor(locale, day, passengerKey)
      .then((res) => {
        if (!live) return;
        if ("error" in res && res.error) setError(res.error);
        else setDrivers((res as { drivers: DriverOption[] }).drivers);
      });
    return () => {
      live = false;
    };
  }, [legId, locale, day, passengerKey]);

  const assign = (driverId: string) =>
    startSaving(async () => {
      if (!legId) return;
      const res = await assignLegToDriver(locale, day, passengerKey, legId, driverId);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
      // Straight back to the list, which now shows this journey covered and
      // the next one waiting — the "and what about the way back?" question
      // asked by the screen instead of left to the user to remember.
      setDrivers(null);
      setLegId(null);
      setRound((r) => r + 1);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("assignTitle")}</DialogTitle>
          <p className="text-sm text-muted-foreground" dir="auto">
            {/* Opened from a red gap, the window is the point. Opened from a
                ride, it is not — and repeating the gap's sentence there was
                describing the wrong thing, at 00:00. */}
            {from != null && to != null
              ? t("assignFor", { who, from: hhmm(from), to: hhmm(to) })
              : t("ridesFor", { who })}
          </p>
        </DialogHeader>

        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("assignWorking")}
          </p>
        )}

        {error && (
          <p className="flex items-center gap-2 rounded-md border border-destructive bg-destructive/10 p-2.5 text-sm text-destructive">
            <Ban className="size-4 shrink-0" />
            {t.has(`assignErr.${error}`) ? t(`assignErr.${error}`) : error}
          </p>
        )}

        {/* Step 1 — the journeys. */}
        {!legId && legs && (
          <ul className="space-y-1.5">
            {legs.map((l) => (
              <li key={l.legId}>
                <button
                  type="button"
                  // A journey with a ride is not finished business: changing
                  // who drives it is the most common thing anybody wants from
                  // this screen, and disabling the row made it the one thing
                  // you could not do.
                  disabled={saving}
                  onClick={() => setLegId(l.legId)}
                  className="flex w-full items-center gap-2 rounded-md border border-border p-2 text-start text-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <CarFront className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1" dir="auto">
                    <span className="block truncate font-medium">
                      {t("legRoute", { from: l.fromLabel, to: l.toLabel })}
                    </span>
                    <span className="block text-xs text-muted-foreground" dir="ltr">
                      {hhmm(l.readyMin)}–{hhmm(l.dueMin)}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      l.served
                        ? "bg-green-500/15 text-green-700 dark:text-green-300"
                        : "bg-amber-400/20 text-amber-800 dark:text-amber-200"
                    }`}
                  >
                    {t(l.served ? "legServed" : "legNeedsRide")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {legId && drivers && drivers.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("assignNone")}</p>
        )}

        {legId && drivers && drivers.length > 0 && (
          <>
            <p className="mb-2 text-sm font-medium">{t("assignPick")}</p>
            <ul className="space-y-1.5">
              {drivers.map((d) => (
                <li key={d.driverId}>
                  <button
                    type="button"
                    disabled={!d.feasible || saving}
                    onClick={() => assign(d.driverId)}
                    className="flex w-full items-center gap-2 rounded-md border border-border p-2 text-start text-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CarFront className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{d.name}</span>
                      {d.plate && (
                        <span className="block text-xs text-muted-foreground" dir="ltr">
                          {d.plate}
                        </span>
                      )}
                    </span>
                    {/* The verdict the ride WOULD get, in the planner's own
                        words — so a dispatcher is not told "assign" and then
                        shown a blocked trip a second later. */}
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        !d.feasible
                          ? "bg-muted text-muted-foreground"
                          : d.status === "INVALID"
                            ? "bg-destructive/15 text-destructive"
                            : d.status === "VALID"
                              ? "bg-green-500/15 text-green-700 dark:text-green-300"
                              : "bg-amber-400/20 text-amber-800 dark:text-amber-200"
                      }`}
                    >
                      {d.feasible
                        ? tp.has(`validation.${d.status}`)
                          ? tp(`validation.${d.status}`)
                          : d.status
                        : t("assignInfeasible")}
                    </span>
                    {d.feasible && <Check className="size-4 shrink-0 opacity-40" />}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
