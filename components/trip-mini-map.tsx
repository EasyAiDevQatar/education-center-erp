"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export type MiniStop = { seq: number; lat: number; lng: number; label: string };

/**
 * Compact route map for a single trip: the numbered stops as a dashed polyline
 * in visit order, on OpenStreetMap tiles. Leaflet is imported dynamically inside
 * the effect so it never touches the server render (the map-picker pattern), and
 * the map is destroyed on unmount so a board of many trips stays light — each
 * card mounts its map only while open.
 */
export function TripMiniMap({ stops, height = 200 }: { stops: MiniStop[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;

    (async () => {
      const L = await import("leaflet");
      if (cancelled || !ref.current || stops.length === 0) return;

      map = L.map(ref.current, { zoomControl: false, attributionControl: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);

      const path = stops.map((s) => [s.lat, s.lng] as [number, number]);
      L.polyline(path, { weight: 3, color: "#2563eb", dashArray: "6 6" }).addTo(map);

      stops.forEach((s) => {
        L.marker([s.lat, s.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div style="background:#2563eb;color:#fff;border-radius:9999px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${s.seq}</div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
        })
          .bindTooltip(`${s.seq}. ${s.label}`)
          .addTo(map!);
      });

      map.fitBounds(L.latLngBounds(path).pad(0.25));
      // The card animates in; give layout a tick before Leaflet measures.
      setTimeout(() => map?.invalidateSize(), 60);
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [stops]);

  if (stops.length === 0) return null;
  return (
    <div
      ref={ref}
      style={{ height }}
      className="w-full overflow-hidden rounded-md border border-border"
    />
  );
}
