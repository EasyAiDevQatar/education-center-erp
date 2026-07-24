"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bus, Map as MapIcon, AlertTriangle, ListChecks, Pencil, RotateCcw } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/crud/form-field";
import { MapPicker } from "@/components/map-picker";
import { TRACKING_VISIBILITY, TRANSPORT_PASSENGERS } from "@/lib/enums";
import {
  saveTransportSettings,
  restoreTransportDefaults,
  saveTransportLogicNote,
} from "./transport-actions";
import { describeLogic, logicWarnings, type LogicInput } from "@/lib/transport/describe";

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
  maxAdvancePickupMin: string;
  driverModel: string;
  /** Admin's own wording of the logic; empty means show the generated one. */
  logicNote: string;
};

const n = (s: string, d: number) => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : d;
};
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}`;

/** Live sandbox: a sample home lesson (09:00–10:30, ~6 km away) run through the
 *  current rules so an admin sees the effect of each knob — and, crucially, the
 *  difference between a driver waiting through the lesson (STAY) and being freed
 *  (DROP_AND_RETURN). Pure client-side; mirrors the generator's timing math. */
/**
 * The rules currently in force, spelled out — plus the values that will produce
 * bad trips. Reads the live knob values, so editing a field immediately rewrites
 * the sentence it affects instead of leaving the admin to guess.
 */
function LogicPanel({ cfg, note }: { cfg: LogicInput; note: string }) {
  const t = useTranslations("transport");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [restoring, startRestore] = useTransition();
  const [saving, startSave] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const lines = describeLogic(cfg);
  const warnings = logicWarnings(cfg);

  // The "who" sentence interpolates a list built from its own sub-keys.
  const render = (key: string, params?: Record<string, string | number>) => {
    if (key === "who" && params) {
      const list = String(params.list)
        .split(",")
        .map((k) => t(`logic.whoParts.${k}`))
        .join("، ");
      return t("logic.who", { list });
    }
    return t(`logic.${key}`, params ?? {});
  };

  /** The generated description as plain numbered text — the editor's starting point. */
  const asText = () => lines.map((l, i) => `${i + 1}. ${render(l.key, l.params)}`).join("\n");

  const commit = (text: string) =>
    startSave(async () => {
      await saveTransportLogicNote(locale, text);
      setEditing(false);
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ListChecks className="size-4 text-primary" />
            <span className="text-sm font-semibold">{t("logic.logicTitle")}</span>
          </div>
          {!editing && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => {
                setDraft(note || asText());
                setEditing(true);
              }}
            >
              <Pencil className="size-3.5" />
              {tc("edit")}
            </Button>
          )}
        </div>

        {editing ? (
          <>
            <p className="mb-2 text-xs text-muted-foreground">{t("logic.logicEditHint")}</p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={14}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs leading-relaxed"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" disabled={saving} onClick={() => commit(draft)}>
                {saving ? tc("saving") : tc("save")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => setEditing(false)}
              >
                {tc("cancel")}
              </Button>
              {/* Puts the generated wording back in the box without saving, so a
                  half-finished edit can always be started over. */}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1"
                disabled={saving}
                onClick={() => setDraft(asText())}
              >
                <RotateCcw className="size-3.5" />
                {t("logic.logicRegenerate")}
              </Button>
            </div>
          </>
        ) : note ? (
          <>
            <p className="mb-2 text-xs text-muted-foreground">{t("logic.logicCustomHint")}</p>
            <p className="whitespace-pre-wrap text-xs leading-relaxed">{note}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 gap-1 px-2 text-xs"
              disabled={saving}
              onClick={() => commit("")}
            >
              <RotateCcw className="size-3.5" />
              {t("logic.logicRegenerate")}
            </Button>
          </>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">{t("logic.logicHint")}</p>
            <ol className="space-y-1.5 text-xs leading-relaxed">
              {lines.map((l, i) => (
                <li key={l.key} className="flex gap-2">
                  <span className="shrink-0 text-muted-foreground">{i + 1}.</span>
                  <span>{render(l.key, l.params)}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" />
            <span className="text-sm font-semibold text-destructive">
              {t("logic.logicFixTitle")}
            </span>
          </div>
          <ul className="space-y-1.5 text-xs leading-relaxed">
            {warnings.map((w) => (
              <li key={w.key} className="flex gap-2">
                <span className="shrink-0 text-destructive">•</span>
                <span>{render(w.key, w.params)}</span>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={restoring}
            onClick={() =>
              startRestore(async () => {
                await restoreTransportDefaults(locale);
                router.refresh();
              })
            }
          >
            {t("logic.logicRestore")}
          </Button>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("logic.logicRestoreHint")}</p>
        </div>
      )}
    </div>
  );
}

function DemoPanel({
  driverModel, speed, detour, prefBuf, minBuf, dismissBuf, boarding, advance,
}: {
  driverModel: string; speed: number; detour: number; prefBuf: number;
  minBuf: number; dismissBuf: number; boarding: number; advance: number;
}) {
  const t = useTranslations("transport");
  const DIST = 6, START = 9 * 60, END = 10 * 60 + 30;
  const travel = Math.max(5, Math.ceil((DIST * detour) / Math.max(5, speed) * 60));
  const target = START - prefBuf;
  const latest = START - minBuf;
  const departPickup = Math.max(START - advance, target - travel - boarding);
  const arriveLesson = departPickup + boarding + travel;
  const late = arriveLesson > latest;
  const readyReturn = END + dismissBuf;
  const arriveHome = readyReturn + travel;

  const AX0 = 8 * 60, AX1 = 11 * 60, RANGE = AX1 - AX0;
  const pos = (m: number) => ((m - AX0) / RANGE) * 100;
  const seg = (a: number, b: number) => ({ insetInlineStart: `${pos(a)}%`, width: `${(pos(b) - pos(a))}%` });
  const drop = driverModel !== "STAY";
  const idle = readyReturn - arriveLesson;

  const Line = ({ label, val, tone }: { label: string; val: string; tone?: string }) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums font-medium ${tone ?? ""}`} dir="ltr">{val}</span>
    </div>
  );

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3 text-xs">
      <p className="text-sm font-medium">{t("demoTitle")}</p>
      <p className="text-muted-foreground">{t("demoHint")}</p>

      {/* timeline */}
      <div className="relative h-14 rounded-md bg-muted/40">
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        {[8, 9, 10, 11].map((h) => (
          <span key={h} className="absolute top-0 -translate-x-1/2 text-[9px] text-muted-foreground" style={{ insetInlineStart: `${pos(h * 60)}%` }} dir="ltr">{h}:00</span>
        ))}
        {/* lesson band */}
        <div className="absolute top-1/2 h-4 -translate-y-1/2 rounded bg-primary/10 ring-1 ring-primary/30" style={seg(START, END)} title={t("demoLesson")} />
        {drop ? (
          <>
            <div className={`absolute top-1/2 h-3 -translate-y-1/2 rounded ${late ? "bg-destructive" : "bg-green-500"}`} style={seg(departPickup, arriveLesson)} />
            <div className="absolute top-1/2 h-3 -translate-y-1/2 rounded bg-green-500" style={seg(readyReturn, arriveHome)} />
          </>
        ) : (
          <div className="absolute top-1/2 h-3 -translate-y-1/2 rounded bg-amber-500" style={seg(departPickup, arriveHome)} />
        )}
      </div>

      <div className="space-y-1">
        <Line label={t("demoPickup")} val={hhmm(departPickup)} />
        <Line label={t("demoArrive")} val={`${hhmm(arriveLesson)}${late ? " ✕" : " ✓"}`} tone={late ? "text-destructive" : "text-green-600"} />
        <Line label={t("demoReturn")} val={hhmm(readyReturn)} />
        <Line label={t("demoHome")} val={hhmm(arriveHome)} />
        <div className="mt-1 rounded-md bg-muted/50 p-2">
          {drop
            ? <span className="text-green-700 dark:text-green-400">{t("demoFree", { n: Math.round(idle) })}</span>
            : <span className="text-amber-700 dark:text-amber-400">{t("demoIdle", { n: Math.round(idle) })}</span>}
        </div>
      </div>
    </div>
  );
}

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

  // Knobs the live demo reads — controlled so the sandbox updates as you type.
  const [driverModel, setDriverModel] = useState(values.driverModel);
  const [advance, setAdvance] = useState(values.maxAdvancePickupMin);
  const [speed, setSpeed] = useState(values.avgSpeedKmh);
  const [detour, setDetour] = useState(values.detourFactor);
  const [prefBuf, setPrefBuf] = useState(values.preferredArrivalBufferMin);
  const [minBuf, setMinBuf] = useState(values.minArrivalBufferMin);
  const [dismissBuf, setDismissBuf] = useState(values.dismissalBufferMin);
  const [boarding, setBoarding] = useState(values.boardingTimeMin);

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
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
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

      {/* Driver model — the biggest logic lever. See the live demo on the side. */}
      <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
        <p className="text-sm font-medium">{t("driverModelTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("driverModelHint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("driverModelLabel")} htmlFor="driverModel">
            <Select id="driverModel" name="transportDriverModel" value={driverModel} onChange={(e) => setDriverModel(e.target.value)}>
              <option value="DROP_AND_RETURN">{t("driverModelDropAndReturn")}</option>
              <option value="STAY">{t("driverModelStay")}</option>
            </Select>
          </FormField>
          <FormField label={t("maxAdvancePickup")} htmlFor="advance" hint={t("maxAdvancePickupHint")}>
            <Input id="advance" name="transportMaxAdvancePickupMin" type="number" min="0" max="240" dir="ltr" value={advance} onChange={(e) => setAdvance(e.target.value)} />
          </FormField>
        </div>
      </div>

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
            <Input id="avgSpeed" name="transportAvgSpeedKmh" type="number" min="5" max="140" dir="ltr" value={speed} onChange={(e) => setSpeed(e.target.value)} />
          </FormField>
          <FormField label={t("rushSpeed")} htmlFor="rushSpeed">
            <Input id="rushSpeed" name="transportRushSpeedKmh" type="number" min="5" max="140" dir="ltr" defaultValue={values.rushSpeedKmh} />
          </FormField>
          <FormField label={t("detourFactor")} htmlFor="detour">
            <Input id="detour" name="transportDetourFactor" type="number" step="0.05" min="1" max="3" dir="ltr" value={detour} onChange={(e) => setDetour(e.target.value)} />
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
            <Input id="paB" name="transportPreferredArrivalBufferMin" type="number" min="0" max="120" dir="ltr" value={prefBuf} onChange={(e) => setPrefBuf(e.target.value)} />
          </FormField>
          <FormField label={t("minArrivalBuffer")} htmlFor="miB">
            <Input id="miB" name="transportMinArrivalBufferMin" type="number" min="0" max="120" dir="ltr" value={minBuf} onChange={(e) => setMinBuf(e.target.value)} />
          </FormField>
          <FormField label={t("maxEarlyArrival")} htmlFor="meA">
            <Input id="meA" name="transportMaxEarlyArrivalMin" type="number" min="0" max="240" dir="ltr" defaultValue={values.maxEarlyArrivalMin} />
          </FormField>
          <FormField label={t("dismissalBuffer")} htmlFor="diB">
            <Input id="diB" name="transportDismissalBufferMin" type="number" min="0" max="120" dir="ltr" value={dismissBuf} onChange={(e) => setDismissBuf(e.target.value)} />
          </FormField>
          <FormField label={t("boardingTime")} htmlFor="boT">
            <Input id="boT" name="transportBoardingTimeMin" type="number" min="0" max="30" dir="ltr" value={boarding} onChange={(e) => setBoarding(e.target.value)} />
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
    <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
      <LogicPanel
        note={values.logicNote}
        cfg={{
          driverModel: driverModel === "STAY" ? "STAY" : "DROP_AND_RETURN",
          maxAdvancePickupMin: n(advance, 60),
          includeTeacher: values.includeTeacher,
          includeStudentToCenter: values.includeStudentToCenter,
          includeStudentToHome: values.includeStudentToHome,
          avgSpeedKmh: n(speed, 40),
          rushSpeedKmh: n(values.rushSpeedKmh, 25),
          detourFactor: n(detour, 1.35),
          preferredArrivalBufferMin: n(prefBuf, 15),
          minArrivalBufferMin: n(minBuf, 5),
          maxEarlyArrivalMin: n(values.maxEarlyArrivalMin, 30),
          dismissalBufferMin: n(dismissBuf, 10),
          boardingTimeMin: n(boarding, 2),
          dropoffTimeMin: n(values.dropoffTimeMin, 2),
          maxStudentWaitMin: n(values.maxStudentWaitMin, 20),
          maxJourneyMin: n(values.maxJourneyMin, 60),
          minDriverTurnaroundMin: n(values.minDriverTurnaroundMin, 10),
          minVehicleTurnaroundMin: n(values.minVehicleTurnaroundMin, 10),
          maxDeadheadKm: n(values.maxDeadheadKm, 25),
          allowInvalidOverride: values.allowInvalidOverride,
        }}
      />
      <DemoPanel
        driverModel={driverModel}
        speed={n(speed, 40)}
        detour={n(detour, 1.35)}
        prefBuf={n(prefBuf, 15)}
        minBuf={n(minBuf, 5)}
        dismissBuf={n(dismissBuf, 10)}
        boarding={n(boarding, 2)}
        advance={n(advance, 60)}
      />
    </div>
    </div>
  );
}
