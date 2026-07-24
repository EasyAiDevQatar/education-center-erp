"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { PlannedDriver } from "@/lib/transport/trip-data";
import { createManualTrip } from "./actions";

/**
 * Build a trip from scratch: pick a driver and a start time. It is created
 * starting at the centre, then the coordinator adds stops with "Add stop".
 */
export function NewTripDialog({
  day,
  drivers,
  onCreated,
}: {
  day: string;
  drivers: PlannedDriver[];
  onCreated: () => void;
}) {
  const t = useTranslations("transportPlanner");
  const tc = useTranslations("common");
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [driverId, setDriverId] = useState("");
  const [time, setTime] = useState("14:00");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const [h, m] = time.split(":").map(Number);
    const startMin = (h || 0) * 60 + (m || 0);
    start(async () => {
      const r = await createManualTrip(locale, { day, driverId, startMin });
      if (r.ok) {
        setOpen(false);
        setDriverId("");
        onCreated();
      } else {
        setError(r.error === "noCentre" ? t("noCentre") : tc("errorGeneric"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1">
          <Plus className="size-4" />
          {t("newTrip")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("newTrip")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label={t("driver")} htmlFor="nt-driver">
            <Select id="nt-driver" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">{t("pickDriver")}</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.plate ? ` · ${d.plate}` : ""}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={t("startTime")} htmlFor="nt-time">
            <Input id="nt-time" type="time" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} />
          </FormField>
          <p className="text-xs text-muted-foreground">{t("newTripHint")}</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("cancel")}</Button>
          </DialogClose>
          <Button type="button" disabled={pending || !driverId} onClick={submit}>
            {pending ? tc("saving") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
