"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export type MiniStop = { seq: number; lat: number; lng: number; label: string };

/**
 * Decode an OSRM/Google encoded polyline (precision 5) to [lat,lng] pairs.
 * Tiny and dependency-free so the map can draw the real road path.
 */
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/**
 * Compact route map for a single trip. When `geometry` (an OSRM encoded
 * polyline) is given it draws the REAL road path as a solid line; otherwise it
 * falls back to a dashed straight-line polyline through the numbered stops.
 * Leaflet is imported dynamically inside the effect so it never touches the
 * server render (the map-picker pattern), and the map is destroyed on unmount so
 * a board of many trips stays light — each card mounts its map only while open.
 */
export function TripMiniMap({
  stops,
  height = 200,
  geometry = null,
}: {
  stops: MiniStop[];
  height?: number;
  geometry?: string | null;
}) {
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

      const stopPath = stops.map((s) => [s.lat, s.lng] as [number, number]);
      // Prefer the real road geometry (solid); fall back to dashed straight
      // segments between stops when no OSRM polyline is available.
      let road: [number, number][] | null = null;
      if (geometry) {
        try {
          const decoded = decodePolyline(geometry);
          if (decoded.length > 1) road = decoded;
        } catch {
          road = null;
        }
      }
      if (road) {
        L.polyline(road, { weight: 4, color: "#2563eb" }).addTo(map);
      } else {
        L.polyline(stopPath, { weight: 3, color: "#2563eb", dashArray: "6 6" }).addTo(map);
      }
      const path = road ?? stopPath;

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
  }, [stops, geometry]);

  if (stops.length === 0) return null;
  return (
    <div
      ref={ref}
      style={{ height }}
      className="w-full overflow-hidden rounded-md border border-border"
    />
  );
}
