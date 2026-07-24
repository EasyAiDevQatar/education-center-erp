"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MapPin, Plus, X, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { minToHHMM } from "@/lib/planner";
import {
  tripPoolingOptions,
  addTripStop,
  removeTripStop,
  type PoolingResult,
  type PoolOption,
} from "./actions";

/**
 * Add a stop to a trip — pick up or drop another teacher on the way.
 *
 * Opens with the current route, the teachers the driver passes near ranked by
 * the detour their home adds ("on the way"), and a manual add for any teacher
 * at any position. Every change re-reads the options so the detours stay honest.
 */
export function AddStopDialog({ tripId, onChanged }: { tripId: string; onChanged: () => void }) {
  const t = useTranslations("transportPlanner");
  const tc = useTranslations("common");
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PoolingResult | null>(null);
  const [pending, start] = useTransition();
  const [teacher, setTeacher] = useState("");
  const [kind, setKind] = useState<"PICKUP" | "DROPOFF">("PICKUP");
  const [after, setAfter] = useState("");

  function load() {
    start(async () => {
      const r = await tripPoolingOptions(locale, tripId);
      if (!("error" in r)) setData(r);
    });
  }
  function onOpenChange(v: boolean) {
    setOpen(v);
    if (v) load();
  }

  function add(o: PoolOption, at: number, k: "PICKUP" | "DROPOFF") {
    start(async () => {
      await addTripStop(locale, {
        tripId,
        afterSeq: at,
        kind: k,
        lat: o.lat,
        lng: o.lng,
        label: o.label,
        teacherId: o.teacherId,
      });
      load();
      onChanged();
    });
  }
  function remove(stopId: string) {
    start(async () => {
      await removeTripStop(locale, stopId);
      load();
      onChanged();
    });
  }

  const suggestions = (data?.options ?? []).filter((o) => o.onTheWay).slice(0, 5);
  const manual = data?.options.find((o) => o.teacherId === teacher) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs">
          <Plus className="size-3.5" />
          {t("addStop")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("addStop")}</DialogTitle>
        </DialogHeader>

        {!data ? (
          <p className="p-2 text-sm text-muted-foreground">{tc("loading")}</p>
        ) : (
          <div className="space-y-4 text-sm">
            {/* Current route */}
            <div>
              <p className="mb-1 font-medium">{t("route")}</p>
              <ol className="space-y-1">
                {data.stops.map((st) => (
                  <li key={st.id} className="flex items-center gap-2">
                    <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                      {st.seq}
                    </span>
                    <span className="tabular-nums text-muted-foreground" dir="ltr">
                      {minToHHMM(st.plannedMin)}
                    </span>
                    <span className="flex-1 font-medium">{st.label}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-6"
                      disabled={pending || data.stops.length <= 2}
                      aria-label={tc("delete")}
                      onClick={() => remove(st.id)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ol>
            </div>

            {/* Smart "on the way" suggestions */}
            {suggestions.length > 0 && (
              <div>
                <p className="mb-1 flex items-center gap-1 font-medium">
                  <Sparkles className="size-3.5 text-primary" />
                  {t("onTheWay")}
                </p>
                <ul className="space-y-1">
                  {suggestions.map((o) => (
                    <li key={o.teacherId} className="flex items-center gap-2 rounded-md border border-border p-2">
                      <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 font-medium">{o.name}</span>
                      <Badge variant="muted">
                        <span dir="ltr">+{o.detourKm.toFixed(1)} km</span>
                      </Badge>
                      <Button type="button" size="sm" disabled={pending} onClick={() => add(o, o.afterSeq, "PICKUP")}>
                        {t("add")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Manual add — any teacher, any place, any position */}
            <div className="space-y-2 rounded-md border border-border p-2">
              <p className="font-medium">{t("addManual")}</p>
              <Select value={teacher} onChange={(e) => setTeacher(e.target.value)} className="h-8">
                <option value="">{t("pickTeacher")}</option>
                {data.options.map((o) => (
                  <option key={o.teacherId} value={o.teacherId}>
                    {o.name} · +{o.detourKm.toFixed(1)}km
                  </option>
                ))}
              </Select>
              <div className="flex flex-wrap gap-2">
                <Select value={kind} onChange={(e) => setKind(e.target.value as "PICKUP" | "DROPOFF")} className="h-8 w-28">
                  <option value="PICKUP">{t("pickup")}</option>
                  <option value="DROPOFF">{t("dropoff")}</option>
                </Select>
                <Select value={after} onChange={(e) => setAfter(e.target.value)} className="h-8 flex-1">
                  <option value="">{t("bestPosition")}</option>
                  <option value="0">{t("atStart")}</option>
                  {data.stops.map((st) => (
                    <option key={st.id} value={String(st.seq)}>
                      {t("afterStop", { n: st.seq })}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending || !manual}
                  onClick={() => manual && add(manual, after === "" ? manual.afterSeq : Number(after), kind)}
                >
                  {t("add")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
