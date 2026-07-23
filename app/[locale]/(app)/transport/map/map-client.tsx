"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LocateFixed, RefreshCw } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import "leaflet/dist/leaflet.css";

export type LiveDriver = {
  tripId: string;
  driverName: string;
  plate: string | null;
  at: string | null;
  accuracyM: number | null;
  position: { lat: number; lng: number } | null;
  path: { lat: number; lng: number }[];
  stops: { label: string; kind: string; lat: number; lng: number; arrived: boolean }[];
};

const DEFAULT_CENTER = { lat: 25.2854, lng: 51.531 };
/** How often the page re-fetches. No websockets in this stack. */
const POLL_MS = 30_000;

export function LiveMapClient({
  drivers,
  centre,
  retentionDays,
}: {
  drivers: LiveDriver[];
  centre: { lat: number; lng: number } | null;
  retentionDays: number;
}) {
  const t = useTranslations("transportMap");
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);
  // Fit the view once. Re-fitting on every poll fights the dispatcher's pan
  // and zoom — the bug that made the reference implementation's map unusable.
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);

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

  // Redraw markers whenever the server sends new data.
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

    for (const d of drivers) {
      if (d.path.length > 1) {
        L.polyline(
          d.path.map((p) => [p.lat, p.lng] as [number, number]),
          { color: "#6366f1", weight: 3, opacity: 0.7 },
        ).addTo(layer);
      }
      for (const s of d.stops) {
        L.circleMarker([s.lat, s.lng], {
          radius: 5,
          color: s.arrived ? "#16a34a" : "#94a3b8",
          fillOpacity: 0.9,
        })
          .addTo(layer)
          .bindTooltip(s.label);
        bounds.push([s.lat, s.lng]);
      }
      if (d.position) {
        L.marker([d.position.lat, d.position.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div style="width:20px;height:20px;border-radius:9999px;background:#f97316;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.5)"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          }),
        })
          .addTo(layer)
          .bindTooltip(`${d.driverName}${d.plate ? ` · ${d.plate}` : ""}`);
        bounds.push([d.position.lat, d.position.lng]);
      }
    }

    if (!fitted.current && bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      fitted.current = true;
    }
  }, [drivers, centre, ready, t]);

  // Poll for fresh pings.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [router]);

  const recentre = () => {
    const map = mapRef.current;
    if (!map) return;
    const pts = drivers.filter((d) => d.position).map((d) => [d.position!.lat, d.position!.lng] as [number, number]);
    if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
    else if (centre) map.setView([centre.lat, centre.lng], 12);
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant={drivers.length ? "success" : "muted"}>
          {t("live", { count: drivers.length })}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {t("retention", { days: retentionDays })}
        </span>
        <div className="ms-auto flex gap-2">
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

      <div
        ref={hostRef}
        className="h-[60vh] min-h-72 w-full overflow-hidden rounded-lg border border-border"
      />

      {drivers.length === 0 && (
        <p className="mt-3 text-center text-sm text-muted-foreground">{t("noneRunning")}</p>
      )}

      <ul className="mt-3 space-y-1">
        {drivers.map((d) => (
          <li
            key={d.tripId}
            className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            <span className="font-medium">{d.driverName}</span>
            {d.plate && (
              <span className="text-muted-foreground" dir="ltr">
                {d.plate}
              </span>
            )}
            {d.at ? (
              <span className="ms-auto text-xs text-muted-foreground" dir="ltr">
                {new Date(d.at).toISOString().slice(11, 16)} UTC
                {d.accuracyM != null ? ` · ±${d.accuracyM} m` : ""}
              </span>
            ) : (
              <span className="ms-auto text-xs text-muted-foreground">{t("noFix")}</span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
