"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Search, MapPin, LocateFixed, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import "leaflet/dist/leaflet.css";

export type LatLng = { lat: number; lng: number };

/** Doha, Qatar — sensible default view when nothing is set yet. */
const DEFAULT_CENTER: LatLng = { lat: 25.2854, lng: 51.531 };

export function MapPicker({
  value,
  onPick,
  trigger,
  title,
}: {
  value?: LatLng | null;
  onPick: (v: LatLng, address?: string) => void;
  trigger: ReactNode;
  title?: string;
}) {
  const t = useTranslations("map");
  const tc = useTranslations("common");

  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<LatLng | null>(value ?? null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const [address, setAddress] = useState<string | undefined>();

  const hostRef = useRef<HTMLDivElement>(null);
  // Leaflet types are loaded dynamically; keep loose refs.
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const markerRef = useRef<import("leaflet").Marker | null>(null);
  const LRef = useRef<typeof import("leaflet") | null>(null);

  // Initialise the map once the dialog is actually on screen.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !hostRef.current) return;
      LRef.current = L;

      // Guard against re-init on the same node (StrictMode / reopen).
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const start = picked ?? value ?? DEFAULT_CENTER;
      const map = L.map(hostRef.current, { attributionControl: true }).setView(
        [start.lat, start.lng],
        picked || value ? 16 : 11,
      );
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      // A CSS pin avoids Leaflet's broken default icon paths under bundlers.
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:22px;height:22px;border-radius:9999px;background:var(--primary);border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.5)"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      const place = (ll: LatLng) => {
        setPicked(ll);
        if (markerRef.current) {
          markerRef.current.setLatLng([ll.lat, ll.lng]);
        } else {
          markerRef.current = L.marker([ll.lat, ll.lng], { icon, draggable: true })
            .addTo(map)
            .on("dragend", (e) => {
              const p = (e.target as import("leaflet").Marker).getLatLng();
              setPicked({ lat: p.lat, lng: p.lng });
              setAddress(undefined);
            });
        }
      };

      if (picked || value) place((picked ?? value)!);
      map.on("click", (e: import("leaflet").LeafletMouseEvent) => {
        place({ lat: e.latlng.lat, lng: e.latlng.lng });
        setAddress(undefined);
      });

      mapRef.current = map;
      // The dialog animates in; recalculate size once settled.
      setTimeout(() => map.invalidateSize(), 150);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function moveTo(ll: LatLng, zoom = 17) {
    setPicked(ll);
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    map.setView([ll.lat, ll.lng], zoom);
    if (markerRef.current) markerRef.current.setLatLng([ll.lat, ll.lng]);
    else {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:22px;height:22px;border-radius:9999px;background:var(--primary);border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.5)"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      markerRef.current = L.marker([ll.lat, ll.lng], { icon, draggable: true }).addTo(map);
    }
  }

  /** Free-text geocoding via OpenStreetMap Nominatim. */
  async function search() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchMsg(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { Accept: "application/json" } },
      );
      const json = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      if (!json.length) {
        setSearchMsg(t("noResults"));
        return;
      }
      const hit = json[0];
      setAddress(hit.display_name);
      moveTo({ lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) });
    } catch {
      setSearchMsg(t("searchFailed"));
    } finally {
      setSearching(false);
    }
  }

  function useCurrent() {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setAddress(undefined);
        moveTo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => setSearchMsg(t("locationDenied")),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title ?? t("title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-1 items-center gap-1">
              <Input
                placeholder={t("searchPlaceholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    search();
                  }
                }}
              />
              <Button type="button" variant="secondary" onClick={search} disabled={searching} className="gap-1">
                {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                {tc("search")}
              </Button>
            </div>
            <Button type="button" variant="outline" onClick={useCurrent} className="gap-1">
              <LocateFixed className="size-4" />
              {t("useCurrent")}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">{t("hint")}</p>

          <div
            ref={hostRef}
            className="h-[55vh] min-h-64 w-full overflow-hidden rounded-md border border-border"
          />

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <MapPin className="size-4" />
              {picked ? (
                <span dir="ltr" className="tabular-nums">
                  {picked.lat.toFixed(6)}, {picked.lng.toFixed(6)}
                </span>
              ) : (
                t("nothingPicked")
              )}
            </span>
            {searchMsg && <span className="text-destructive">{searchMsg}</span>}
          </div>
          {address && <p className="truncate text-xs text-muted-foreground">{address}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("cancel")}</Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!picked}
            onClick={() => {
              if (picked) onPick(picked, address);
              setOpen(false);
            }}
          >
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
