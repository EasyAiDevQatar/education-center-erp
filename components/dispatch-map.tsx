"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export type MapTrip = {
  id: string;
  /** Driver colour (hex). */
  color: string;
  /** Return trips (centre → homes) draw dashed, deliveries solid (mockup). */
  dashed: boolean;
  /** OSRM encoded polyline, or null → straight segments through the stops. */
  geometry: string | null;
  stops: { seq: number; lat: number; lng: number; label: string }[];
};

/** Decode an OSRM/Google polyline (precision 5) to [lat,lng] pairs. */
function decodePolyline(encoded: string): [number, number][] {
  const pts: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < encoded.length) {
    let r = 0;
    let s = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(i++) - 63;
      r |= (b & 0x1f) << s;
      s += 5;
    } while (b >= 0x20);
    lat += r & 1 ? ~(r >> 1) : r >> 1;
    r = 0;
    s = 0;
    do {
      b = encoded.charCodeAt(i++) - 63;
      r |= (b & 0x1f) << s;
      s += 5;
    } while (b >= 0x20);
    lng += r & 1 ? ~(r >> 1) : r >> 1;
    pts.push([lat / 1e5, lng / 1e5]);
  }
  return pts;
}

/**
 * Every trip on one map, coloured by driver — the cockpit's spatial view.
 * Deliveries (to the centre) are solid, returns dashed. Leaflet is imported
 * inside the effect so it never touches the server render, and destroyed on
 * unmount. Reuses the OSRM geometry the board already stores.
 */
export function DispatchMap({
  trips,
  centre,
  height = 340,
}: {
  trips: MapTrip[];
  centre: { lat: number; lng: number } | null;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;

    (async () => {
      const L = await import("leaflet");
      if (cancelled || !ref.current) return;

      map = L.map(ref.current, { zoomControl: true, attributionControl: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);

      const allPts: [number, number][] = [];

      for (const trip of trips) {
        let road: [number, number][] | null = null;
        if (trip.geometry) {
          try {
            const d = decodePolyline(trip.geometry);
            if (d.length > 1) road = d;
          } catch {
            road = null;
          }
        }
        const path = road ?? trip.stops.map((s) => [s.lat, s.lng] as [number, number]);
        if (path.length > 1) {
          L.polyline(path, {
            weight: 3.5,
            color: trip.color,
            dashArray: trip.dashed ? "6 6" : undefined,
            opacity: 0.85,
          }).addTo(map!);
        }
        for (const s of trip.stops) {
          allPts.push([s.lat, s.lng]);
          L.marker([s.lat, s.lng], {
            icon: L.divIcon({
              className: "",
              html: `<div style="background:${trip.color};color:#fff;border-radius:9999px;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${s.seq}</div>`,
              iconSize: [18, 18],
              iconAnchor: [9, 9],
            }),
          })
            .bindTooltip(`${s.seq}. ${s.label}`)
            .addTo(map!);
        }
      }

      if (centre) {
        allPts.push([centre.lat, centre.lng]);
        L.marker([centre.lat, centre.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div style="background:#111827;color:#fff;border-radius:6px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:13px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)">◆</div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          }),
        }).addTo(map!);
      }

      if (allPts.length > 0) {
        map.fitBounds(L.latLngBounds(allPts).pad(0.2));
      } else if (centre) {
        map.setView([centre.lat, centre.lng], 12);
      } else {
        map.setView([25.3, 51.5], 11);
      }
      setTimeout(() => map?.invalidateSize(), 60);
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [trips, centre]);

  return (
    <div
      ref={ref}
      style={{ height }}
      className="w-full overflow-hidden rounded-lg border border-border"
    />
  );
}
