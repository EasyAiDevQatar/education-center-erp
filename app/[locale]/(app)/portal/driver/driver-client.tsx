"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Phone, Navigation, Play, Check, Flag, MapPin, Satellite } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { minToHHMM } from "@/lib/planner";
import {
  DEFAULT_TRACKING_POLICY,
  shouldSendPing,
  type Fix,
} from "@/lib/transport/tracking";
import { startTrip, completeTrip, arriveAtStop, recordPing } from "./actions";

export type DriverStop = {
  id: string;
  seq: number;
  kind: string;
  label: string;
  lat: number;
  lng: number;
  plannedMin: number;
  arrived: boolean;
  passengerName: string | null;
  passengerPhone: string | null;
};

export type DriverTrip = {
  id: string;
  status: string;
  plate: string | null;
  plannedStartMin: number;
  plannedEndMin: number;
  estimatedKm: number;
  stops: DriverStop[];
};

/** Hand off to OpenStreetMap for turn-by-turn — no app install, no API key. */
function directionsHref(lat: number, lng: number) {
  return `https://www.openstreetmap.org/directions?to=${lat}%2C${lng}`;
}

export function DriverClient({ trips, today }: { trips: DriverTrip[]; today: string }) {
  const t = useTranslations("driverApp");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [trackingOn, setTrackingOn] = useState(false);
  const [trackNote, setTrackNote] = useState<string | null>(null);

  const watchId = useRef<number | null>(null);
  // The last fix that was SUCCESSFULLY written. Advanced only after the server
  // confirms — a failed write must be retried, not skipped.
  const lastSent = useRef<Fix | null>(null);
  const running = trips.find((x) => x.status === "STARTED") ?? null;

  const stopTracking = useCallback(() => {
    if (watchId.current !== null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchId.current);
    }
    watchId.current = null;
    lastSent.current = null;
    setTrackingOn(false);
  }, []);

  /** Begin watching, after an explicit consent tap. */
  const beginTracking = useCallback(
    (tripId: string) => {
      if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
        setTrackNote(t("noGeolocation"));
        return;
      }
      // Browsers only expose geolocation on a secure origin.
      if (typeof window !== "undefined" && !window.isSecureContext) {
        setTrackNote(t("needsHttps"));
        return;
      }

      const onFix = (pos: GeolocationPosition) => {
        const fix: Fix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy ?? null,
          at: pos.timestamp || Date.now(),
        };
        const decision = shouldSendPing(fix, lastSent.current, DEFAULT_TRACKING_POLICY);
        if (!decision.send) return;
        void recordPing({
          tripId,
          lat: fix.lat,
          lng: fix.lng,
          accuracyM: fix.accuracyM == null ? null : Math.round(fix.accuracyM),
        }).then((res) => {
          // Only now does the cursor move.
          if (res.ok) lastSent.current = fix;
        });
      };

      // One immediate fix (this is what triggers the permission prompt and
      // gives the dispatcher a position straight away), then watch.
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          onFix(pos);
          watchId.current = navigator.geolocation.watchPosition(onFix, () => {}, {
            enableHighAccuracy: true,
            maximumAge: 10_000,
            timeout: 20_000,
          });
          setTrackingOn(true);
          setTrackNote(null);
        },
        () => setTrackNote(t("locationDenied")),
        { enableHighAccuracy: true, timeout: 15_000 },
      );
    },
    [t],
  );

  // Tracking runs only while a trip is actually STARTED, and never survives
  // leaving the screen.
  useEffect(() => {
    if (!running && watchId.current !== null) stopTracking();
    return () => {
      if (watchId.current !== null && typeof navigator !== "undefined") {
        navigator.geolocation.clearWatch(watchId.current);
      }
    };
  }, [running, stopTracking]);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  if (trips.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        {t("noTrips")}
      </div>
    );
  }

  return (
    <>
      {/* Tracking banner: consent is explicit and the state is always visible. */}
      {running && (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Satellite className={`size-4 ${trackingOn ? "text-primary" : "text-muted-foreground"}`} />
            <span className="text-sm font-medium">
              {trackingOn ? t("trackingOn") : t("trackingOff")}
            </span>
            <div className="ms-auto">
              {trackingOn ? (
                <Button type="button" size="sm" variant="outline" onClick={stopTracking}>
                  {t("stopTracking")}
                </Button>
              ) : (
                <Button type="button" size="sm" onClick={() => beginTracking(running.id)}>
                  {t("startTracking")}
                </Button>
              )}
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t("trackingConsent")}</p>
          {trackNote && <p className="mt-1 text-xs text-destructive">{trackNote}</p>}
        </div>
      )}

      <div className="space-y-3">
        {trips.map((trip) => (
          <div key={trip.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  trip.status === "STARTED"
                    ? "success"
                    : trip.status === "COMPLETED"
                      ? "muted"
                      : "default"
                }
              >
                {te(`tripStatus.${trip.status}`)}
              </Badge>
              <span className="tabular-nums text-lg font-semibold" dir="ltr">
                {minToHHMM(trip.plannedStartMin)}
              </span>
              {trip.plate && (
                <span className="text-sm text-muted-foreground" dir="ltr">
                  {trip.plate}
                </span>
              )}
              <span className="ms-auto text-sm text-muted-foreground" dir="ltr">
                {trip.estimatedKm.toFixed(1)} km
              </span>
            </div>

            {/* Stops in order — big touch targets, one action each. */}
            <ol className="mt-3 space-y-2">
              {trip.stops.map((s) => (
                <li
                  key={s.id}
                  className={`rounded-md border p-3 ${
                    s.arrived ? "border-border bg-muted/40" : "border-border"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <MapPin className="size-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{te(`tripStopKind.${s.kind}`)}</span>
                    <span className="tabular-nums text-muted-foreground" dir="ltr">
                      {minToHHMM(s.plannedMin)}
                    </span>
                    {s.arrived && <Badge variant="success">{t("arrived")}</Badge>}
                  </div>
                  <p className="mt-1 text-sm">{s.label}</p>
                  {s.passengerName && (
                    <p className="text-sm text-muted-foreground">{s.passengerName}</p>
                  )}

                  <div className="mt-2 flex flex-wrap gap-2">
                    {s.passengerPhone && (
                      <a href={`tel:${s.passengerPhone}`}>
                        <Button type="button" size="sm" variant="outline" className="gap-1">
                          <Phone className="size-4" />
                          {t("call")}
                        </Button>
                      </a>
                    )}
                    <a
                      href={directionsHref(s.lat, s.lng)}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <Button type="button" size="sm" variant="outline" className="gap-1">
                        <Navigation className="size-4" />
                        {t("navigate")}
                      </Button>
                    </a>
                    {trip.status === "STARTED" && !s.arrived && (
                      <Button
                        type="button"
                        size="sm"
                        className="gap-1"
                        disabled={pending}
                        onClick={() => run(() => arriveAtStop(locale, s.id))}
                      >
                        <Check className="size-4" />
                        {t("markArrived")}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-3 flex flex-wrap gap-2">
              {trip.status === "ASSIGNED" && (
                <Button
                  type="button"
                  className="w-full gap-2 py-6 text-base"
                  disabled={pending}
                  onClick={() => run(() => startTrip(locale, trip.id))}
                >
                  <Play className="size-5" />
                  {t("startTrip")}
                </Button>
              )}
              {trip.status === "STARTED" && (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full gap-2 py-6 text-base"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const res = await completeTrip(locale, trip.id);
                      stopTracking();
                      return res;
                    })
                  }
                >
                  <Flag className="size-5" />
                  {t("completeTrip")}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-muted-foreground" dir="ltr">
        {today}
      </p>
    </>
  );
}
