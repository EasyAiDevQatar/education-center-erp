"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useModuleFlags } from "@/components/app-shell/module-flags";
import { Route, Phone, MapPin, ExternalLink, Users } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { TimeRange } from "@/components/time-range";
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
  /** Present when several per-student accounting rows share one group lesson. */
  group?: {
    name: string | null;
    members: {
      id: string;
      studentName: string;
      levelLabel: string;
      status: string;
      paymentStatus: string;
      total: number;
    }[];
  } | null;
};

/** Render a pre-formatted "HH:MM–HH:MM · Xh" label so the range flows with the
 *  ambient direction (Arabic: start on the right), each clock staying LTR. */
function flipTimeLabel(label: string): React.ReactNode {
  const dot = label.indexOf("·");
  const rangePart = (dot >= 0 ? label.slice(0, dot) : label).trim();
  const durPart = dot >= 0 ? label.slice(dot + 1).trim() : "";
  const parts = rangePart.split(/[–—-]/);
  if (parts.length !== 2) return label;
  return (
    <span className="tabular-nums">
      <bdi dir="ltr">{parts[0].trim()}</bdi>
      <span className="mx-0.5">–</span>
      <bdi dir="ltr">{parts[1].trim()}</bdi>
      {durPart ? ` · ${durPart}` : null}
    </span>
  );
}

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

  const reveal = (data: HoverSessionData, x: number, y: number) => {
    const W = 300;
    const H = 420;
    setActive({
      data,
      x: Math.max(8, Math.min(x + 14, window.innerWidth - W - 8)),
      y: Math.max(8, Math.min(y + 14, window.innerHeight - H - 8)),
    });
  };

  const bind = (data: HoverSessionData) => ({
    onMouseEnter: (e: React.MouseEvent) => {
      // Touch devices synthesise hover; a tap should act, not preview.
      if (window.matchMedia?.("(hover: none)").matches) return;
      const { clientX: x, clientY: y } = e;
      clear();
      clearHide();
      timer.current = setTimeout(() => {
        reveal(data, x, y);
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
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      clear();
      clearHide();
      const rect = e.currentTarget.getBoundingClientRect();
      reveal(data, rect.right, rect.top);
    },
    onBlur: scheduleHide,
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
  const { transport } = useModuleFlags();
  const d = data;

  return (
    <div
      className="fixed z-[100] w-72 space-y-1.5 rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-xl"
      style={{ left: x, top: y }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">
          {d.group && <Users className="size-4 shrink-0 text-primary" />}
          <span className="truncate">{d.group?.name || d.studentName}</span>
        </span>
        {d.group ? (
          <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {t("studentsCount", { n: d.group.members.length })}
          </span>
        ) : (
          <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium">
            {te(`sessionStatus.${d.status as "SCHEDULED"}`)}
          </span>
        )}
      </div>

      <Row label={t("teacher")} value={d.teacherName} />
      <Row label={t("subject")} value={d.subjectLabel} />
      {!d.group && <Row label={t("grade")} value={d.levelLabel} />}
      <Row label={t("time")} value={flipTimeLabel(d.timeLabel)} />
      {!d.group && <Row label={t("total")} value={`${formatMoney(d.total)} ${currency}`} ltr />}
      {!d.group && d.paymentStatus && (
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
      {!d.group && d.guardianPhone && (
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

      {d.group && (
        <div className="mt-1 border-t border-border pt-1.5">
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>{t("roster")}</span>
            <span>{t("individualAccounting")}</span>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto pe-1">
            {d.group.members.map((member) => (
              <div key={member.id} className="flex items-center gap-2 rounded bg-accent/50 px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate font-medium">{member.studentName}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {te(`sessionStatus.${member.status as "SCHEDULED"}`)}
                </span>
                <span className="shrink-0 tabular-nums" dir="ltr">
                  {formatMoney(member.total)} {currency}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Everything below is the transport module talking: the ride, who is
          driving it, the little map, the link into the live map. With the
          module off none of it has a meaning, so none of it is drawn — not
          even the "no trip yet" line, which otherwise reports a gap in a
          system the centre does not run. */}
      {transport && !d.group && d.location === "HOME" && (
        <div className="mt-1 space-y-1 border-t border-border pt-1.5">
          <div className="flex items-center gap-1.5 font-semibold">
            <Route className={`size-3.5 ${tripTint(d.trip)}`} />
            {d.trip ? (
              <span>
                {te(`tripStatus.${d.trip.status as "PROPOSED"}`)}
                <span className="tabular-nums">
                  {" · "}
                  <TimeRange start={d.trip.startMin} end={d.trip.endMin} />
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
      {transport && !d.group && d.location === "HOME" && !d.home && (
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
