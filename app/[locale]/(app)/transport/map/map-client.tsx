"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LocateFixed, RefreshCw, Route, Car } from "lucide-react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { minToHHMM } from "@/lib/planner";
import "leaflet/dist/leaflet.css";

export type MapStop = {
  lat: number;
  lng: number;
  label: string;
  kind: string;
  plannedMin: number;
  arrived: boolean;
};

export type MapTrip = {
  id: string;
  status: string;
  driverName: string | null;
  plate: string | null;
  passengerName: string | null;
  plannedStartMin: number;
  plannedEndMin: number;
  estimatedKm: number;
  plannedPath: MapStop[];
  actualPath: { lat: number; lng: number }[];
  position: { lat: number; lng: number } | null;
  at: string | null;
  accuracyM: number | null;
};

const DEFAULT_CENTER = { lat: 25.2854, lng: 51.531 };
/** How often the page re-fetches. No websockets in this stack. */
const POLL_MS = 30_000;

/** Distinct colour per trip so overlapping routes stay tellable apart. */
const TRIP_COLOURS = [
  "#6366f1", "#0ea5e9", "#f97316", "#16a34a",
  "#d946ef", "#ef4444", "#0d9488", "#a16207",
];
const colourFor = (i: number) => TRIP_COLOURS[i % TRIP_COLOURS.length];

function statusVariant(status: string) {
  if (status === "PROPOSED") return "warning" as const;
  if (status === "STARTED") return "success" as const;
  if (status === "COMPLETED") return "muted" as const;
  return "default" as const;
}

export function LiveMapClient({
  trips,
  day,
  centre,
  retentionDays,
}: {
  trips: MapTrip[];
  day: string;
  centre: { lat: number; lng: number } | null;
  retentionDays: number;
}) {
  const t = useTranslations("transportMap");
  const te = useTranslations("enums");
  const router = useRouter();
  const pathname = usePathname();

  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  // Fit the view once. Re-fitting on every poll fights the dispatcher's pan
  // and zoom — the bug that made the reference implementation's map unusable.
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  /** Null = show every trip; otherwise focus one. */
  const [selected, setSelected] = useState<string | null>(null);

  const running = useMemo(() => trips.filter((x) => x.status === "STARTED"), [trips]);
  const shown = useMemo(
    () => (selected ? trips.filter((x) => x.id === selected) : trips),
    [trips, selected],
  );

  // Initialise the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !hostRef.current || mapRef.current) return;
      LRef.current = L;
      const startAt = centre ?? DEFAULT_CENTER;
      const map = L.map(hostRef.current).setView([startAt.lat, startAt.lng], 12);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 150);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw whenever the data or the selection changes.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer || !ready) return;
    layer.clearLayers();

    const bounds: [number, number][] = [];

    if (centre) {
      L.marker([centre.lat, centre.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="width:14px;height:14px;border-radius:3px;background:#0ea5e9;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
      })
        .addTo(layer)
        .bindTooltip(t("centre"));
      bounds.push([centre.lat, centre.lng]);
    }

    shown.forEach((trip) => {
      const colour = colourFor(trips.findIndex((x) => x.id === trip.id));
      const pts = trip.plannedPath.map((s) => [s.lat, s.lng] as [number, number]);

      // The suggested route: dashed, so it never reads as "where they went".
      if (pts.length > 1) {
        L.polyline(pts, {
          color: colour,
          weight: 3,
          opacity: 0.85,
          dashArray: "7 6",
        })
          .addTo(layer)
          .bindTooltip(
            `${trip.passengerName ?? ""} · ${minToHHMM(trip.plannedStartMin)} · ${trip.estimatedKm.toFixed(1)} km`,
          );
      }

      // Numbered stops, so the order of the route is readable, not guessed.
      trip.plannedPath.forEach((s, i) => {
        L.marker([s.lat, s.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div style="display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:9999px;background:${colour};color:#fff;font:600 11px/1 system-ui;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)">${i + 1}</div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          }),
        })
          .addTo(layer)
          .bindTooltip(
            `${i + 1}. ${te(`tripStopKind.${s.kind}`)} — ${s.label} · ${minToHHMM(s.plannedMin)}`,
          );
        bounds.push([s.lat, s.lng]);
      });

      // Where the vehicle actually went: solid, and only exists once driving.
      if (trip.actualPath.length > 1) {
        L.polyline(
          trip.actualPath.map((p) => [p.lat, p.lng] as [number, number]),
          { color: colour, weight: 4, opacity: 0.55 },
        ).addTo(layer);
      }

      if (trip.position) {
        L.marker([trip.position.lat, trip.position.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div style="width:18px;height:18px;border-radius:9999px;background:${colour};border:3px solid #fff;box-shadow:0 0 0 3px ${colour}55"></div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          }),
        })
          .addTo(layer)
          .bindTooltip(`${trip.driverName ?? ""}${trip.plate ? ` · ${trip.plate}` : ""}`);
        bounds.push([trip.position.lat, trip.position.lng]);
      }
    });

    // Fit once on load, and again whenever the dispatcher picks a trip — that
    // click is an explicit "show me this", unlike a background poll.
    if ((!fitted.current || selected) && bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      fitted.current = true;
    }
  }, [shown, trips, centre, ready, selected, t, te]);

  // Poll for fresh pings.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [router]);

  const goDay = (d: string) => router.push(`${pathname}?date=${d}`);
  const shiftDay = (delta: number) => {
    const dt = new Date(`${day}T00:00:00.000Z`);
    dt.setUTCDate(dt.getUTCDate() + delta);
    goDay(dt.toISOString().slice(0, 10));
  };

  const recentre = () => {
    const map = mapRef.current;
    if (!map) return;
    const pts = shown.flatMap((x) => x.plannedPath.map((s) => [s.lat, s.lng] as [number, number]));
    if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
    else if (centre) map.setView([centre.lat, centre.lng], 12);
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => shiftDay(-1)}>
          ‹
        </Button>
        <Input
          type="date"
          dir="ltr"
          value={day}
          onChange={(e) => e.target.value && goDay(e.target.value)}
          className="w-40"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => shiftDay(1)}>
          ›
        </Button>

        <Badge variant={running.length ? "success" : "muted"}>
          {t("live", { count: running.length })}
        </Badge>
        <Badge variant="default">{t("plannedCount", { count: trips.length })}</Badge>

        <div className="ms-auto flex gap-2">
          {selected && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setSelected(null)}>
              {t("showAll")}
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={recentre}>
            <LocateFixed className="size-4" />
            {t("recentre")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => router.refresh()}
          >
            <RefreshCw className="size-4" />
            {t("refresh")}
          </Button>
        </div>
      </div>

      {/* Legend: a dashed line and a solid one mean different things. */}
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <svg width="26" height="6" aria-hidden>
            <line x1="0" y1="3" x2="26" y2="3" stroke="currentColor" strokeWidth="3" strokeDasharray="7 6" />
          </svg>
          {t("legendPlanned")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="26" height="6" aria-hidden>
            <line x1="0" y1="3" x2="26" y2="3" stroke="currentColor" strokeWidth="4" opacity="0.55" />
          </svg>
          {t("legendActual")}
        </span>
        <span>{t("retention", { days: retentionDays })}</span>
      </div>

      <div
        ref={hostRef}
        className="h-[60vh] min-h-72 w-full overflow-hidden rounded-lg border border-border"
      />

      {trips.length === 0 ? (
        <p className="mt-3 text-center text-sm text-muted-foreground">{t("nonePlanned")}</p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {trips.map((trip, i) => {
            const colour = colourFor(i);
            const active = selected === trip.id;
            return (
              <li key={trip.id}>
                <button
                  type="button"
                  onClick={() => setSelected(active ? null : trip.id)}
                  aria-pressed={active}
                  className={cn(
                    "w-full rounded-lg border bg-card p-3 text-start transition-colors hover:bg-accent",
                    active ? "border-primary ring-1 ring-primary" : "border-border",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ background: colour }}
                      aria-hidden
                    />
                    <span className="font-medium">{trip.passengerName ?? "—"}</span>
                    <Badge variant={statusVariant(trip.status)}>
                      {te(`tripStatus.${trip.status}`)}
                    </Badge>
                    <span className="ms-auto tabular-nums text-sm" dir="ltr">
                      {minToHHMM(trip.plannedStartMin)}–{minToHHMM(trip.plannedEndMin)}
                    </span>
                  </div>

                  {/* The suggested path, written out — the map shows where, this
                      shows the order and the times without hunting for pins. */}
                  <ol className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    {trip.plannedPath.map((s, n) => (
                      <li key={`${trip.id}-${n}`} className="flex items-center gap-1.5">
                        <span
                          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                          style={{ background: colour }}
                        >
                          {n + 1}
                        </span>
                        <span className="truncate">{s.label}</span>
                        <span className="ms-auto shrink-0 tabular-nums" dir="ltr">
                          {minToHHMM(s.plannedMin)}
                        </span>
                        {s.arrived && <span className="shrink-0 text-[var(--success)]">✓</span>}
                      </li>
                    ))}
                  </ol>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Car className="size-3.5" />
                      {trip.driverName ?? t("noDriver")}
                      {trip.plate && <span dir="ltr">· {trip.plate}</span>}
                    </span>
                    <span className="inline-flex items-center gap-1" dir="ltr">
                      <Route className="size-3.5" />
                      {trip.estimatedKm.toFixed(1)} km
                    </span>
                    {trip.at && (
                      <span dir="ltr">
                        {new Date(trip.at).toISOString().slice(11, 16)} UTC
                        {trip.accuracyM != null ? ` · ±${trip.accuracyM} m` : ""}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
