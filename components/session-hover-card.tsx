"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Route, Phone, MapPin, ExternalLink } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import "leaflet/dist/leaflet.css";

/** The slice of a trip a session card needs to show. Built server-side by
 *  lib/session-trips.ts (which imports this type — single source of truth). */
export type SessionTripLite = {
  id: string;
  status: string;
  driverName: string | null;
  plate: string | null;
  startMin: number;
  endMin: number;
  stops: { lat: number; lng: number; label: string; kind: string }[];
};

export type HoverSessionData = {
  studentName: string;
  teacherName: string | null;
  subjectLabel: string | null;
  levelLabel: string | null;
  /** Already formatted, e.g. "14:00–15:30 · 1.5h". */
  timeLabel: string;
  total: number;
  status: string;
  paymentStatus: string | null;
  location: "CENTER" | "HOME";
  addressLabel: string | null;
  guardianPhone: string | null;
  home: { lat: number; lng: number } | null;
  centre: { lat: number; lng: number } | null;
  trip: SessionTripLite | null;
  /** Day for the "open transport map" link (YYYY-MM-DD). */
  mapDate: string | null;
};

const minToHHMM = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

/** Route-icon tint per trip state; muted outline means "no trip yet". */
export function tripTint(trip: SessionTripLite | null | undefined): string {
  if (!trip) return "text-muted-foreground/50";
  if (trip.status === "PROPOSED") return "text-warning";
  if (trip.status === "PLANNED") return "text-primary";
  return "text-success"; // ASSIGNED / STARTED / COMPLETED — someone is driving
}

/**
 * Hover details for session cards.
 *
 * A hook rather than a wrapper because both card surfaces (calendar, planner)
 * are drag-enabled absolutely-positioned divs — spreading `bind(data)` onto
 * the existing element leaves their layout and pointer handling untouched,
 * where wrapping them would not. The popover renders through a portal, so
 * `portal` can be dropped anywhere in the tree.
 */
export function useSessionHover(currency: string) {
  const [active, setActive] = useState<{ data: HoverSessionData; x: number; y: number } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const clearHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  // Grace period so the pointer can travel from the card INTO the popover
  // (to read details or click the map link) without it vanishing.
  const scheduleHide = () => {
    clearHide();
    hideTimer.current = setTimeout(() => setActive(null), 250);
  };
  useEffect(() => () => {
    clear();
    clearHide();
  }, []);

  const bind = (data: HoverSessionData) => ({
    onMouseEnter: (e: React.MouseEvent) => {
      // Touch devices synthesise hover; a tap should act, not preview.
      if (window.matchMedia?.("(hover: none)").matches) return;
      const { clientX: x, clientY: y } = e;
      clear();
      clearHide();
      timer.current = setTimeout(() => {
        const W = 300;
        const H = 420;
        setActive({
          data,
          x: Math.max(8, Math.min(x + 14, window.innerWidth - W - 8)),
          y: Math.max(8, Math.min(y + 14, window.innerHeight - H - 8)),
        });
      }, 350);
    },
    onMouseLeave: () => {
      clear();
      scheduleHide();
    },
    // A drag or click supersedes the preview.
    onPointerDown: () => {
      clear();
      clearHide();
      setActive(null);
    },
  });

  const portal =
    active && typeof document !== "undefined"
      ? createPortal(
          <HoverCard
            data={active.data}
            currency={currency}
            x={active.x}
            y={active.y}
            onMouseEnter={clearHide}
            onMouseLeave={scheduleHide}
          />,
          document.body,
        )
      : null;

  const hide = () => {
    clear();
    setActive(null);
  };

  return { bind, portal, hide };
}

function Row({ label, value, ltr }: { label: string; value: React.ReactNode; ltr?: boolean }) {
  if (value == null || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate font-medium" dir={ltr ? "ltr" : undefined}>
        {value}
      </span>
    </div>
  );
}

function HoverCard({
  data,
  currency,
  x,
  y,
  onMouseEnter,
  onMouseLeave,
}: {
  data: HoverSessionData;
  currency: string;
  x: number;
  y: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const t = useTranslations("hoverCard");
  const te = useTranslations("enums");
  const d = data;

  return (
    <div
      className="fixed z-[100] w-72 space-y-1.5 rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-xl"
      style={{ left: x, top: y }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">{d.studentName}</span>
        <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium">
          {te(`sessionStatus.${d.status as "SCHEDULED"}`)}
        </span>
      </div>

      <Row label={t("teacher")} value={d.teacherName} />
      <Row label={t("subject")} value={d.subjectLabel} />
      <Row label={t("grade")} value={d.levelLabel} />
      <Row label={t("time")} value={d.timeLabel} ltr />
      <Row label={t("total")} value={`${formatMoney(d.total)} ${currency}`} ltr />
      {d.paymentStatus && (
        <Row label={t("payment")} value={te(`paymentStatus.${d.paymentStatus as "PAID"}`)} />
      )}
      <Row
        label={t("location")}
        value={
          d.location === "HOME" && d.addressLabel
            ? `${te("location.HOME")} · ${d.addressLabel}`
            : te(`location.${d.location}`)
        }
      />
      {d.guardianPhone && (
        <Row
          label={t("guardian")}
          value={
            <span className="inline-flex items-center gap-1" dir="ltr">
              <Phone className="size-3" />
              {d.guardianPhone}
            </span>
          }
        />
      )}

      {d.location === "HOME" && (
        <div className="mt-1 space-y-1 border-t border-border pt-1.5">
          <div className="flex items-center gap-1.5 font-semibold">
            <Route className={`size-3.5 ${tripTint(d.trip)}`} />
            {d.trip ? (
              <span>
                {te(`tripStatus.${d.trip.status as "PROPOSED"}`)}
                <span className="tabular-nums" dir="ltr">
                  {" "}
                  · {minToHHMM(d.trip.startMin)}–{minToHHMM(d.trip.endMin)}
                </span>
              </span>
            ) : (
              <span className="font-normal text-muted-foreground">{t("noTripYet")}</span>
            )}
          </div>
          {d.trip?.driverName && (
            <Row
              label={t("driver")}
              value={d.trip.plate ? `${d.trip.driverName} · ${d.trip.plate}` : d.trip.driverName}
            />
          )}
          {(d.home || d.trip) && (
            <HoverMiniMap home={d.home} centre={d.centre} trip={d.trip} />
          )}
          {d.mapDate && (
            <Link
              href={`/transport/map?date=${d.mapDate}`}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <ExternalLink className="size-3" />
              {t("openMap")}
            </Link>
          )}
        </div>
      )}
      {d.location === "HOME" && !d.home && (
        <p className="flex items-center gap-1 text-muted-foreground">
          <MapPin className="size-3" />
          {t("noPin")}
        </p>
      )}
    </div>
  );
}

/**
 * Tiny static preview: the trip's stop sequence as a polyline, or — when no
 * trip exists yet — a dashed suggested line from the centre to the home.
 * Leaflet loads on first render of a card only; the map is display-only.
 */
function HoverMiniMap({
  home,
  centre,
  trip,
}: {
  home: { lat: number; lng: number } | null;
  centre: { lat: number; lng: number } | null;
  trip: SessionTripLite | null;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !ref.current) return;
      map = L.map(ref.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
      const pts: [number, number][] = [];
      const dot = (p: { lat: number; lng: number }, color: string) =>
        L.circleMarker([p.lat, p.lng], { radius: 5, color, weight: 2, fillOpacity: 0.85 }).addTo(
          map!,
        );
      if (trip && trip.stops.length > 0) {
        const path = trip.stops.map((s) => [s.lat, s.lng] as [number, number]);
        L.polyline(path, { weight: 3, color: "#2563eb" }).addTo(map);
        for (const s of trip.stops) dot(s, s.kind === "PICKUP" ? "#2563eb" : "#16a34a");
        pts.push(...path);
      } else {
        if (centre && home) {
          L.polyline(
            [
              [centre.lat, centre.lng],
              [home.lat, home.lng],
            ],
            { weight: 2, color: "#64748b", dashArray: "6 6" },
          ).addTo(map);
        }
        if (centre) {
          dot(centre, "#64748b");
          pts.push([centre.lat, centre.lng]);
        }
        if (home) {
          dot(home, "#dc2626");
          pts.push([home.lat, home.lng]);
        }
      }
      if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.3));
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [home, centre, trip]);

  return <div ref={ref} className="h-36 w-full overflow-hidden rounded-md border border-border" />;
}
