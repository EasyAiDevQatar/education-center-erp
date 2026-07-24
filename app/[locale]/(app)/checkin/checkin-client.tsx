"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MapPin, LogIn, LogOut, Home, Building2, X, Loader2, Undo2 } from "lucide-react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { distanceMeters, GEOFENCE_RADIUS_M } from "@/lib/geo";
import { localNowTime, localToday } from "@/lib/session-time";
import {
  checkInSession,
  checkOutSession,
  markNoShow,
  undoCheckin,
} from "./actions";

export type CheckinItem = {
  id: string;
  studentName: string;
  teacherName: string;
  levelLabel: string;
  location: "CENTER" | "HOME";
  startMinutes: number;
  hours: number;
  status: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  hasPin: boolean;
  homeLat: number | null;
  homeLng: number | null;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function fmtTime(min: number) {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

const STATUS_BADGE: Record<string, "success" | "warning" | "muted" | "destructive"> = {
  SCHEDULED: "muted",
  CHECKED_IN: "warning",
  COMPLETED: "success",
  NO_SHOW: "destructive",
  CANCELLED: "muted",
};

type Panel = {
  id: string;
  mode: "CENTER" | "HOME";
  loading: boolean;
  coords?: { lat: number; lng: number };
  distance?: number | null;
  geoError?: string;
  pin: string;
  submitError?: string;
};

export function CheckinClient({ day, items }: { day: string; items: CheckinItem[] }) {
  const t = useTranslations("checkin");
  const te = useTranslations("enums");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const [q, setQ] = useState("");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [pending, start] = useTransition();
  const today = localToday();

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter(
      (i) => i.studentName.toLowerCase().includes(s) || i.teacherName.toLowerCase().includes(s),
    );
  }, [items, q]);

  function refresh() {
    router.refresh();
  }

  function run(fn: () => Promise<{ ok?: boolean; error?: string }>) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setPanel(null);
        refresh();
      } else if (panel) {
        setPanel({ ...panel, submitError: res.error });
      }
    });
  }

  // Center kiosk check-in: if a PIN is required, open a panel; else go straight.
  function startCenterCheckIn(item: CheckinItem) {
    if (item.hasPin) {
      setPanel({ id: item.id, mode: "CENTER", loading: false, pin: "" });
    } else {
      run(() => checkInSession(locale, { id: item.id, method: "KIOSK" }));
    }
  }

  // Home GPS check-in: open panel and capture geolocation.
  function startHomeCheckIn(item: CheckinItem) {
    setPanel({ id: item.id, mode: "HOME", loading: true, pin: "" });
    if (!("geolocation" in navigator)) {
      setPanel({ id: item.id, mode: "HOME", loading: false, pin: "", geoError: "denied" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const distance =
          item.homeLat != null && item.homeLng != null
            ? distanceMeters(item.homeLat, item.homeLng, lat, lng)
            : null;
        setPanel({ id: item.id, mode: "HOME", loading: false, pin: "", coords: { lat, lng }, distance });
      },
      () => setPanel({ id: item.id, mode: "HOME", loading: false, pin: "", geoError: "denied" }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }

  function submitPanel(item: CheckinItem) {
    if (!panel) return;
    if (panel.mode === "CENTER") {
      run(() => checkInSession(locale, { id: item.id, method: "KIOSK", pin: panel.pin }));
    } else {
      if (!panel.coords) return;
      run(() =>
        checkInSession(locale, {
          id: item.id,
          method: "GPS",
          lat: panel.coords!.lat,
          lng: panel.coords!.lng,
          pin: panel.pin,
        }),
      );
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="date"
          dir="ltr"
          value={day}
          onChange={(e) => router.push(`${pathname}?date=${e.target.value}`)}
          className="w-44"
        />
        {day !== today && (
          <Button variant="secondary" size="sm" onClick={() => router.push(pathname)}>
            {t("todaySessions")}
          </Button>
        )}
        <Input
          placeholder={t("searchStudent")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full sm:w-72"
        />
      </div>

      {filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-muted-foreground">
          {t("noSessionsToday")}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((item) => {
          const open = panel?.id === item.id;
          const nearOk = panel?.distance != null && panel.distance <= GEOFENCE_RADIUS_M;
          const canSubmit =
            panel?.mode === "CENTER"
              ? true
              : !!panel?.coords && (panel?.distance == null || nearOk);
          return (
            <div key={item.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{item.studentName}</span>
                    {item.location === "HOME" ? (
                      <Home className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Building2 className="size-4 shrink-0 text-muted-foreground" />
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">{item.teacherName} · {item.levelLabel}</div>
                  <div className="text-sm tabular-nums text-muted-foreground">
                    {fmtTime(item.startMinutes)} · {item.hours}h
                  </div>
                </div>
                <Badge variant={STATUS_BADGE[item.status] ?? "muted"}>
                  {te(`sessionStatus.${item.status}`)}
                </Badge>
              </div>

              {(item.checkedInAt || item.checkedOutAt) && (
                <div className="mt-2 flex flex-wrap gap-x-3 text-xs tabular-nums text-muted-foreground">
                  {item.checkedInAt && <span>{t("checkedInAt", { time: item.checkedInAt })}</span>}
                  {item.checkedOutAt && <span>{t("checkedOutAt", { time: item.checkedOutAt })}</span>}
                </div>
              )}

              {/* Action panel (PIN / GPS) */}
              {open && (
                <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/40 p-2">
                  {panel!.mode === "HOME" && (
                    <div className="text-sm">
                      {panel!.loading && (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Loader2 className="size-3 animate-spin" /> {t("capturingLocation")}
                        </span>
                      )}
                      {panel!.geoError && <span className="text-destructive">{t("locationDenied")}</span>}
                      {panel!.coords && panel!.distance == null && (
                        <span className="text-warning">{t("locationNoHome")}</span>
                      )}
                      {panel!.distance != null && (
                        <span className={cn("inline-flex items-center gap-1", nearOk ? "text-success" : "text-destructive")}>
                          <MapPin className="size-3" />
                          {nearOk
                            ? t("locationOk", { m: panel!.distance })
                            : t("locationFar", { m: panel!.distance, max: GEOFENCE_RADIUS_M })}
                        </span>
                      )}
                    </div>
                  )}

                  {item.hasPin && (
                    <div>
                      <Input
                        inputMode="numeric"
                        placeholder={t("enterPin")}
                        value={panel!.pin}
                        onChange={(e) => setPanel({ ...panel!, pin: e.target.value, submitError: undefined })}
                        className="w-32"
                        dir="ltr"
                      />
                    </div>
                  )}

                  {panel!.submitError === "pin" && <p className="text-xs text-destructive">{t("pinWrong")}</p>}
                  {panel!.submitError === "tooFar" && (
                    <p className="text-xs text-destructive">{t("locationFar", { m: panel!.distance ?? 0, max: GEOFENCE_RADIUS_M })}</p>
                  )}

                  <div className="flex gap-2">
                    <Button size="sm" disabled={pending || !canSubmit} onClick={() => submitPanel(item)} className="gap-1">
                      <LogIn className="size-4" />
                      {t("verifyAndCheckIn")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPanel(null)} className="gap-1">
                      <X className="size-4" />
                      {tc("cancel")}
                    </Button>
                  </div>
                </div>
              )}

              {/* Primary actions by status */}
              {!open && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.status === "SCHEDULED" && (
                    <>
                      {item.location === "HOME" ? (
                        <Button size="sm" onClick={() => startHomeCheckIn(item)} className="gap-1">
                          <MapPin className="size-4" />
                          {t("homeVerify")}
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => startCenterCheckIn(item)} className="gap-1">
                          <LogIn className="size-4" />
                          {t("checkIn")}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markNoShow(locale, item.id))}>
                        {t("markNoShow")}
                      </Button>
                    </>
                  )}
                  {item.status === "CHECKED_IN" && (
                    <>
                      <Button size="sm" disabled={pending} onClick={() => run(() => checkOutSession(locale, item.id))} className="gap-1">
                        <LogOut className="size-4" />
                        {t("checkOut")}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => undoCheckin(locale, item.id))} className="gap-1">
                        <Undo2 className="size-4" />
                        {t("undo")}
                      </Button>
                    </>
                  )}
                  {(item.status === "COMPLETED" || item.status === "NO_SHOW") && (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => undoCheckin(locale, item.id))} className="gap-1">
                      <Undo2 className="size-4" />
                      {t("undo")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
