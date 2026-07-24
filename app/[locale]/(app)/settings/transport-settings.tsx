"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bus, Map as MapIcon } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/crud/form-field";
import { MapPicker } from "@/components/map-picker";
import { TRACKING_VISIBILITY, TRANSPORT_PASSENGERS } from "@/lib/enums";
import { saveTransportSettings } from "./transport-actions";

export type TransportValues = {
  enabled: boolean;
  centerLat: string;
  centerLng: string;
  avgSpeedKmh: string;
  rushSpeedKmh: string;
  rushWindows: string;
  detourFactor: string;
  minTripMin: string;
  bufferMin: string;
  maxDeadheadKm: string;
  pingDays: string;
  trackingVisibility: string;
  passengers: string;
  includeTeacher: boolean;
  includeStudentToCenter: boolean;
  includeStudentToHome: boolean;
  preferredArrivalBufferMin: string;
  minArrivalBufferMin: string;
  maxEarlyArrivalMin: string;
  dismissalBufferMin: string;
  boardingTimeMin: string;
  dropoffTimeMin: string;
  maxStudentWaitMin: string;
  maxJourneyMin: string;
  minDriverTurnaroundMin: string;
  minVehicleTurnaroundMin: string;
  allowInvalidOverride: boolean;
};

export function TransportSettings({ values }: { values: TransportValues }) {
  const t = useTranslations("transport");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();

  const [lat, setLat] = useState(values.centerLat);
  const [lng, setLng] = useState(values.centerLng);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setMsg(null);
    setErr(null);
    start(async () => {
      const r = await saveTransportSettings(locale, {}, fd);
      if (r.ok) {
        setMsg(tc("saved"));
        router.refresh();
      } else setErr(r.error ?? "invalid");
    });
  }

  const hasCentre = !!lat && !!lng;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex items-center gap-2">
        <Bus className="size-5 text-primary" />
        <span className="font-semibold">{t("moduleTitle")}</span>
        {values.enabled && <Badge variant="success">{tc("active")}</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">{t("moduleIntro")}</p>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="transportEnabled"
          defaultChecked={values.enabled}
          className="size-4 accent-primary"
        />
        {t("enableLabel")}
      </label>
      <p className="text-xs text-muted-foreground">{t("enableHint")}</p>

      {/* Centre location — the most common trip endpoint, so it is asked for
          first and picked on a map rather than typed. */}
      <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
        <p className="text-sm font-medium">{t("centreLocation")}</p>
        <p className="text-xs text-muted-foreground">{t("centreLocationHint")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <FormField label={t("lat")} htmlFor="centerLat">
            <Input
              id="centerLat"
              name="centerLat"
              dir="ltr"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="25.285400"
            />
          </FormField>
          <FormField label={t("lng")} htmlFor="centerLng">
            <Input
              id="centerLng"
              name="centerLng"
              dir="ltr"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              placeholder="51.531000"
            />
          </FormField>
          <MapPicker
            value={
              hasCentre && !Number.isNaN(parseFloat(lat)) && !Number.isNaN(parseFloat(lng))
                ? { lat: parseFloat(lat), lng: parseFloat(lng) }
                : null
            }
            onPick={(v) => {
              setLat(v.lat.toFixed(6));
              setLng(v.lng.toFixed(6));
            }}
            trigger={
              <Button type="button" variant="secondary" size="sm" className="gap-1">
                <MapIcon className="size-3.5" />
                {t("pickOnMap")}
              </Button>
            }
          />
          {!hasCentre && <Badge variant="warning">{t("centreMissing")}</Badge>}
        </div>
      </div>

      {/* Travel-time model */}
      <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
        <p className="text-sm font-medium">{t("etaTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("etaHint")}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <FormField label={t("avgSpeed")} htmlFor="avgSpeed">
            <Input id="avgSpeed" name="transportAvgSpeedKmh" type="number" min="5" max="140" dir="ltr" defaultValue={values.avgSpeedKmh} />
          </FormField>
          <FormField label={t("rushSpeed")} htmlFor="rushSpeed">
            <Input id="rushSpeed" name="transportRushSpeedKmh" type="number" min="5" max="140" dir="ltr" defaultValue={values.rushSpeedKmh} />
          </FormField>
          <FormField label={t("detourFactor")} htmlFor="detour">
            <Input id="detour" name="transportDetourFactor" type="number" step="0.05" min="1" max="3" dir="ltr" defaultValue={values.detourFactor} />
          </FormField>
          <FormField label={t("minTripMin")} htmlFor="minTrip">
            <Input id="minTrip" name="transportMinTripMin" type="number" min="0" max="60" dir="ltr" defaultValue={values.minTripMin} />
          </FormField>
        </div>
        <FormField label={t("rushWindows")} htmlFor="rushWindows" hint={t("rushWindowsHint")}>
          <Input id="rushWindows" name="transportRushWindows" dir="ltr" defaultValue={values.rushWindows} />
        </FormField>
      </div>

      {/* Allocation + tracking */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <FormField label={t("bufferMin")} htmlFor="buffer" hint={t("bufferHint")}>
          <Input id="buffer" name="transportBufferMin" type="number" min="0" max="120" dir="ltr" defaultValue={values.bufferMin} />
        </FormField>
        <FormField label={t("maxDeadhead")} htmlFor="deadhead" hint={t("maxDeadheadHint")}>
          <Input id="deadhead" name="transportMaxDeadheadKm" type="number" min="1" max="200" dir="ltr" defaultValue={values.maxDeadheadKm} />
        </FormField>
        <FormField label={t("pingDays")} htmlFor="pingDays" hint={t("pingDaysHint")}>
          <Input id="pingDays" name="transportPingDays" type="number" min="1" max="365" dir="ltr" defaultValue={values.pingDays} />
        </FormField>
        <FormField label={t("passengers")} htmlFor="passengers" hint={t("passengersHint")}>
          <Select id="passengers" name="transportPassengers" defaultValue={values.passengers}>
            {TRANSPORT_PASSENGERS.map((v) => (
              <option key={v} value={v}>{te(`transportPassengers.${v}`)}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("trackingVisibility")} htmlFor="visibility" hint={t("trackingVisibilityHint")}>
          <Select id="visibility" name="transportTrackingVisibility" defaultValue={values.trackingVisibility}>
            {TRACKING_VISIBILITY.map((v) => (
              <option key={v} value={v}>{te(`trackingVisibility.${v}`)}</option>
            ))}
          </Select>
        </FormField>
      </div>

      <div className="space-y-2 rounded-md border border-border p-3">
        <p className="text-sm font-medium">{t("inclusion")}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="transportIncludeTeacher" defaultChecked={values.includeTeacher} className="size-4 accent-primary" />
          {t("includeTeacher")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="transportIncludeStudentToCenter" defaultChecked={values.includeStudentToCenter} className="size-4 accent-primary" />
          {t("includeStudentToCenter")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="transportIncludeStudentToHome" defaultChecked={values.includeStudentToHome} className="size-4 accent-primary" />
          {t("includeStudentToHome")}
        </label>
      </div>

      <div className="space-y-2 rounded-md border border-border p-3">
        <p className="text-sm font-medium">{t("validationTiming")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t("preferredArrivalBuffer")} htmlFor="paB">
            <Input id="paB" name="transportPreferredArrivalBufferMin" type="number" min="0" max="120" dir="ltr" defaultValue={values.preferredArrivalBufferMin} />
          </FormField>
          <FormField label={t("minArrivalBuffer")} htmlFor="miB">
            <Input id="miB" name="transportMinArrivalBufferMin" type="number" min="0" max="120" dir="ltr" defaultValue={values.minArrivalBufferMin} />
          </FormField>
          <FormField label={t("maxEarlyArrival")} htmlFor="meA">
            <Input id="meA" name="transportMaxEarlyArrivalMin" type="number" min="0" max="240" dir="ltr" defaultValue={values.maxEarlyArrivalMin} />
          </FormField>
          <FormField label={t("dismissalBuffer")} htmlFor="diB">
            <Input id="diB" name="transportDismissalBufferMin" type="number" min="0" max="120" dir="ltr" defaultValue={values.dismissalBufferMin} />
          </FormField>
          <FormField label={t("boardingTime")} htmlFor="boT">
            <Input id="boT" name="transportBoardingTimeMin" type="number" min="0" max="30" dir="ltr" defaultValue={values.boardingTimeMin} />
          </FormField>
          <FormField label={t("dropoffTime")} htmlFor="drT">
            <Input id="drT" name="transportDropoffTimeMin" type="number" min="0" max="30" dir="ltr" defaultValue={values.dropoffTimeMin} />
          </FormField>
          <FormField label={t("maxStudentWait")} htmlFor="mSW">
            <Input id="mSW" name="transportMaxStudentWaitMin" type="number" min="0" max="240" dir="ltr" defaultValue={values.maxStudentWaitMin} />
          </FormField>
          <FormField label={t("maxJourney")} htmlFor="mJ">
            <Input id="mJ" name="transportMaxJourneyMin" type="number" min="0" max="600" dir="ltr" defaultValue={values.maxJourneyMin} />
          </FormField>
          <FormField label={t("driverTurnaround")} htmlFor="dTa">
            <Input id="dTa" name="transportMinDriverTurnaroundMin" type="number" min="0" max="120" dir="ltr" defaultValue={values.minDriverTurnaroundMin} />
          </FormField>
          <FormField label={t("vehicleTurnaround")} htmlFor="vTa">
            <Input id="vTa" name="transportMinVehicleTurnaroundMin" type="number" min="0" max="120" dir="ltr" defaultValue={values.minVehicleTurnaroundMin} />
          </FormField>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="transportAllowInvalidOverride" defaultChecked={values.allowInvalidOverride} className="size-4 accent-primary" />
          {t("allowInvalidOverride")}
        </label>
        <p className="text-xs text-muted-foreground">{t("allowInvalidOverrideHint")}</p>
      </div>

      {msg && <p className="text-sm text-[var(--success)]">{msg}</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? tc("saving") : tc("save")}
      </Button>
    </form>
  );
}
