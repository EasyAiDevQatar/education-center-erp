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

/** Minimal shape of the native detector — no library, no bundle cost. */
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (s: CanvasImageSource) => Promise<DetectedBarcode[]> };

/**
 * Camera check-in for the reception tablet.
 *
 * Uses the browser's built-in BarcodeDetector rather than pulling in a scanning
 * library — it is available in Chrome/Edge, which is what a kiosk runs. Where
 * it is missing (Safari, Firefox) the dialog falls back to typing the code off
 * the card, so the feature degrades instead of disappearing.
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
  const [supported, setSupported] = useState<boolean | null>(null);
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
      const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike })
        .BarcodeDetector;
      if (!Ctor) {
        setSupported(false);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
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
        setSupported(true);

        const detector = new Ctor({ formats: ["qr_code"] });
        timer = setInterval(async () => {
          if (!videoRef.current || busyRef.current) return;
          try {
            const found = await detector.detect(videoRef.current);
            if (found.length > 0) submitToken(found[0].rawValue);
          } catch {
            // A single failed frame is not worth surfacing.
          }
        }, 400);
      } catch {
        // Permission denied or no camera — the manual field still works.
        setSupported(false);
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
          {supported !== false ? (
            <div className="relative overflow-hidden rounded-lg bg-black">
              <video ref={videoRef} playsInline muted className="aspect-video w-full object-cover" />
              <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70" />
            </div>
          ) : (
            <p className="flex items-center gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
              <CameraOff className="size-4 shrink-0" />
              {t("noCamera")}
            </p>
          )}

          {supported === null && (
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
