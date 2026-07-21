"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Camera, CameraOff, Check, X, RefreshCw } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/crud/form-field";
import { minToHHMM } from "@/lib/planner";
import { checkInByQr, type ScanOutcome } from "../actions";
import { createQrDecoder, classifyCameraError, type CameraError } from "@/lib/qr-decode";

export type ScanRow = {
  id: string;
  studentName: string;
  teacherName: string | null;
  startMin: number;
  hours: number;
  status: string;
};

type Feed = { ok: boolean; name: string; at: string };

/**
 * Always-on scanning station for the reception device.
 *
 * The camera stays live between students rather than being torn down with a
 * dialog, so a queue moves at the speed of holding up cards. Every scan lands
 * in a running feed so staff can see at a glance what was recorded.
 */
export function ScanStation({
  day,
  recent,
  pickSession,
  walkInMode,
}: {
  day: string;
  recent: ScanRow[];
  pickSession: boolean;
  walkInMode: string;
}) {
  const t = useTranslations("checkin");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [camera, setCamera] = useState<"starting" | "live" | CameraError>("starting");
  // Which decoder is in play, so the UI can explain a slower fallback.
  const [decoderKind, setDecoderKind] = useState<"native" | "fallback" | null>(null);
  const [manual, setManual] = useState("");
  const [feed, setFeed] = useState<Feed[]>([]);
  const [choice, setChoice] = useState<ScanOutcome | null>(null);
  const [pending, start] = useTransition();

  const push = useCallback((ok: boolean, name: string) => {
    setFeed((f) => [{ ok, name, at: new Date().toLocaleTimeString() }, ...f].slice(0, 12));
  }, []);

  const submit = useCallback(
    (token: string, sessionId?: string) => {
      if (!token.trim() || busyRef.current) return;
      busyRef.current = true;
      start(async () => {
        const res = await checkInByQr(locale, {
          token: token.trim(),
          date: day,
          sessionId: sessionId ?? null,
        });
        if (res.ok) {
          push(true, t("scanned", { name: res.studentName ?? "" }));
          setChoice(null);
          router.refresh();
        } else if (res.choices && res.choices.length > 0) {
          // More than one candidate and the centre asked to be shown them.
          setChoice(res);
        } else {
          push(false, t(`scanErrors.${res.error ?? "invalid"}`));
        }
        // Cooldown so one card held to the lens doesn't fire repeatedly.
        setTimeout(() => {
          busyRef.current = false;
        }, 2000);
      });
    },
    [locale, day, push, t, router],
  );

  /* ---- camera lifecycle ---- */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      // Decoder and camera are independent: Safari has no BarcodeDetector but a
      // perfectly good camera, so a missing decoder must never stop the camera.
      let decoder;
      try {
        decoder = await createQrDecoder();
        if (cancelled) return;
        setDecoderKind(decoder.kind);
      } catch {
        if (!cancelled) setCamera("unsupported");
        return;
      }

      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no getUserMedia");
        // `environment` is a preference, not a requirement — a laptop only has
        // a front camera and an exact constraint would fail outright there.
        const constraints: MediaStreamConstraints = {
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : { facingMode: { ideal: "environment" } },
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current?.getTracks().forEach((tr) => tr.stop());
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCamera("live");

        // Labels only populate after permission is granted, so enumerate here.
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === "videoinput");
        if (!cancelled) {
          setCameras(cams);
          if (!deviceId && cams.length) {
            const active = stream.getVideoTracks()[0]?.getSettings().deviceId;
            if (active) setDeviceId(active);
          }
        }

        // jsQR does more work per frame, so give it a little more breathing room.
        const interval = decoder.kind === "native" ? 400 : 600;
        timer = setInterval(async () => {
          if (!videoRef.current || busyRef.current) return;
          const text = await decoder.scan(videoRef.current);
          if (text) submit(text);
        }, interval);
      } catch (err) {
        if (!cancelled) setCamera(classifyCameraError(err));
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Camera */}
      <div className="space-y-3">
        {camera === "starting" || camera === "live" ? (
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} playsInline muted className="aspect-video w-full object-cover" />
            <div className="pointer-events-none absolute inset-10 rounded-lg border-2 border-white/70" />
            {pending && (
              <div className="absolute inset-x-0 bottom-0 bg-primary/90 py-1 text-center text-sm text-primary-foreground">
                {tc("saving")}
              </div>
            )}
          </div>
        ) : (
          <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm">
            <CameraOff className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span>
              <span className="font-medium text-destructive">{t(`cameraErrors.${camera}`)}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t(`cameraHints.${camera}`)}
              </span>
            </span>
          </p>
        )}

        {decoderKind === "fallback" && camera === "live" && (
          <p className="text-xs text-muted-foreground">{t("fallbackDecoder")}</p>
        )}

        {cameras.length > 1 && (
          <FormField label={t("camera")} htmlFor="cam">
            <Select id="cam" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              {cameras.map((c, i) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label || `${t("camera")} ${i + 1}`}
                </option>
              ))}
            </Select>
          </FormField>
        )}

        <FormField label={t("manualCode")} htmlFor="manual" hint={t("manualHint")}>
          <div className="flex gap-2">
            <Input
              id="manual"
              dir="ltr"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit(manual);
                  setManual("");
                }
              }}
            />
            <Button
              disabled={pending || !manual.trim()}
              onClick={() => {
                submit(manual);
                setManual("");
              }}
            >
              {t("checkIn")}
            </Button>
          </div>
        </FormField>

        {walkInMode === "FLAG" && (
          <p className="text-xs text-muted-foreground">{t("walkInFlagHint")}</p>
        )}
      </div>

      {/* Feed + today */}
      <div className="space-y-3">
        {/* Which session to credit, when the centre asked to be shown them */}
        {choice?.choices && (
          <div className="rounded-lg border-2 border-primary bg-primary/5 p-3">
            <p className="mb-2 text-sm font-medium">
              {t("pickSessionFor", { name: choice.studentName ?? "" })}
            </p>
            <div className="space-y-1">
              {choice.choices.map((c) => (
                <button
                  key={c.id}
                  onClick={() => submit(choice.token ?? "", c.id)}
                  disabled={pending}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <span className="tabular-nums" dir="ltr">{minToHHMM(c.startMin)}</span>
                  <span className="truncate">{c.teacherName ?? t("noTeacher")}</span>
                  <Badge variant="default">{te(`sessionStatus.${c.status}`)}</Badge>
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              onClick={() => setChoice(null)}
            >
              {tc("cancel")}
            </Button>
          </div>
        )}

        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold">{t("scanFeed")}</span>
            <Button variant="ghost" size="icon" aria-label={tc("refresh")} onClick={() => router.refresh()}>
              <RefreshCw className="size-4" />
            </Button>
          </div>
          {feed.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("feedEmpty")}</p>
          )}
          <div className="space-y-1">
            {feed.map((f, i) => (
              <div
                key={i}
                className={
                  f.ok
                    ? "flex items-center gap-2 rounded-md bg-success/10 px-2 py-1.5 text-sm"
                    : "flex items-center gap-2 rounded-md bg-destructive/10 px-2 py-1.5 text-sm"
                }
              >
                {f.ok ? (
                  <Check className="size-4 shrink-0 text-[var(--success)]" />
                ) : (
                  <X className="size-4 shrink-0 text-destructive" />
                )}
                <span className="truncate">{f.name}</span>
                <span className="ms-auto shrink-0 text-xs text-muted-foreground tabular-nums" dir="ltr">
                  {f.at}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 flex items-center gap-2">
            <Camera className="size-4" />
            <span className="font-semibold">{t("todaySoFar")}</span>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {recent.length === 0 && (
              <p className="py-4 text-center text-muted-foreground">{tc("noData")}</p>
            )}
            {recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {r.studentName}
                  <span className="text-muted-foreground"> · {r.teacherName ?? t("noTeacher")}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums" dir="ltr">
                    {minToHHMM(r.startMin)}
                  </span>
                  <Badge variant={r.status === "COMPLETED" ? "success" : "default"}>
                    {te(`sessionStatus.${r.status}`)}
                  </Badge>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
