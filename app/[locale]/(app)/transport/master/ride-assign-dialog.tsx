"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Ban, CarFront, Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { hhmm } from "@/components/transport/timeline";
import { driverOptionsFor, type DriverOption } from "./actions";
import { assignToDriver } from "../dispatch/actions";

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
  from: number;
  to: number;
}) {
  const t = useTranslations("transportMaster");
  const tp = useTranslations("transportPlanner");
  const locale = useLocale();
  const router = useRouter();

  const [drivers, setDrivers] = useState<DriverOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    let live = true;
    driverOptionsFor(locale, day, passengerKey)
      .then((res) => {
        if (!live) return;
        if ("error" in res && res.error) setError(res.error);
        else setDrivers((res as { drivers: DriverOption[] }).drivers);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [locale, day, passengerKey]);

  const assign = (driverId: string) =>
    startSaving(async () => {
      const res = await assignToDriver(locale, day, passengerKey, driverId);
      if (res.error) {
        setError(res.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("assignTitle")}</DialogTitle>
          <p className="text-sm text-muted-foreground" dir="auto">
            {t("assignFor", { who, from: hhmm(from), to: hhmm(to) })}
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

        {drivers && drivers.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("assignNone")}</p>
        )}

        {drivers && drivers.length > 0 && (
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
