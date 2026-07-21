"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Camera, CameraOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkInByQr } from "./actions";
import { createQrDecoder, classifyCameraError, type CameraError } from "@/lib/qr-decode";

/**
 * Camera check-in for the reception tablet.
 *
 * Decoding goes through `lib/qr-decode`, which prefers the browser's built-in
 * BarcodeDetector and falls back to jsQR where it is missing (Safari, Firefox).
 * The camera is opened regardless of which decoder is available — the two are
 * unrelated, and treating a missing decoder as a missing camera is what used to
 * make this dialog refuse to scan on browsers whose camera worked fine.
 */
export function QrScanner({
  day,
  onClose,
  onResult,
}: {
  day: string;
  onClose: () => void;
  onResult: (message: string) => void;
}) {
  const t = useTranslations("checkin");
  const tc = useTranslations("common");
  const locale = useLocale();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const [camera, setCamera] = useState<"starting" | "live" | CameraError>("starting");
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [pending, start] = useTransition();

  function submitToken(token: string) {
    if (!token.trim() || busyRef.current) return;
    busyRef.current = true;
    start(async () => {
      const res = await checkInByQr(locale, { token: token.trim(), date: day });
      if (res.ok) {
        onResult(t("scanned", { name: res.studentName ?? "" }));
        setError(null);
      } else {
        setError(res.error ?? "invalid");
      }
      // Brief cooldown so one card held to the lens doesn't fire repeatedly.
      setTimeout(() => {
        busyRef.current = false;
      }, 2500);
    });
  }

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      // Decoder and camera are independent — a browser without BarcodeDetector
      // still has a working camera, so the decoder falls back instead of the
      // whole feature switching itself off.
      let decoder;
      try {
        decoder = await createQrDecoder();
        if (cancelled) return;
      } catch {
        if (!cancelled) setCamera("unsupported");
        return;
      }

      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no getUserMedia");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCamera("live");

        const interval = decoder.kind === "native" ? 400 : 600;
        timer = setInterval(async () => {
          if (!videoRef.current || busyRef.current) return;
          const text = await decoder.scan(videoRef.current);
          if (text) submitToken(text);
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
  }, [day]);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("scanTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {camera === "starting" || camera === "live" ? (
            <div className="relative overflow-hidden rounded-lg bg-black">
              <video ref={videoRef} playsInline muted className="aspect-video w-full object-cover" />
              <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70" />
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

          {camera === "starting" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Camera className="size-4" />
              {tc("loading")}
            </p>
          )}

          <FormField label={t("manualCode")} htmlFor="qr-manual" hint={t("manualHint")}>
            <Input
              id="qr-manual"
              dir="ltr"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitToken(manual);
                  setManual("");
                }
              }}
            />
          </FormField>

          {error && <p className="text-sm text-destructive">{t(`scanErrors.${error}`)}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("close")}</Button>
          </DialogClose>
          <Button
            type="button"
            disabled={pending || !manual.trim()}
            onClick={() => {
              submitToken(manual);
              setManual("");
            }}
          >
            {pending ? tc("saving") : t("checkIn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
