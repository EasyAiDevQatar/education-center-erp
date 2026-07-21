/**
 * QR decoding from a live video element, with a fallback.
 *
 * Chrome and Edge ship a native `BarcodeDetector`, which is fast and costs no
 * bundle. Safari and Firefox do not — so those fall back to jsQR over a canvas
 * frame. The two are kept behind one interface because the caller should not
 * care which is in play, and because conflating "no decoder" with "no camera"
 * is what made the scanner claim the camera was unavailable on Safari when it
 * was working perfectly.
 */

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (s: CanvasImageSource) => Promise<DetectedBarcode[]> };

export type QrDecoder = {
  /** Returns the decoded text, or null when this frame holds no QR. */
  scan: (video: HTMLVideoElement) => Promise<string | null>;
  /** Which implementation is active — surfaced for support diagnostics. */
  kind: "native" | "fallback";
};

function nativeDecoder(): QrDecoder | null {
  const Ctor = (
    window as unknown as {
      BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike;
    }
  ).BarcodeDetector;
  if (!Ctor) return null;

  const detector = new Ctor({ formats: ["qr_code"] });
  return {
    kind: "native",
    scan: async (video) => {
      try {
        const found = await detector.detect(video);
        return found.length > 0 ? found[0].rawValue : null;
      } catch {
        // A single unreadable frame is normal while focusing.
        return null;
      }
    },
  };
}

async function fallbackDecoder(): Promise<QrDecoder> {
  // Loaded on demand so browsers with the native API never pay for it.
  const jsQR = (await import("jsqr")).default;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  return {
    kind: "fallback",
    scan: async (video) => {
      if (!ctx || !video.videoWidth) return null;
      // Half resolution: plenty for a card held up close, and roughly four
      // times less pixel work per frame on a low-powered tablet.
      const w = Math.floor(video.videoWidth / 2);
      const h = Math.floor(video.videoHeight / 2);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(video, 0, 0, w, h);
      const image = ctx.getImageData(0, 0, w, h);
      const found = jsQR(image.data, w, h, { inversionAttempts: "dontInvert" });
      return found?.data ?? null;
    },
  };
}

/** Best available decoder for this browser. */
export async function createQrDecoder(): Promise<QrDecoder> {
  return nativeDecoder() ?? (await fallbackDecoder());
}

/** Distinguishes the ways a camera can fail, so the UI can say which happened. */
export type CameraError = "insecure" | "unsupported" | "denied" | "notFound" | "failed";

export function classifyCameraError(err: unknown): CameraError {
  // getUserMedia only exists in a secure context; over plain http it is
  // undefined, which reads as "unsupported" unless we check the context first.
  if (typeof window !== "undefined" && !window.isSecureContext) return "insecure";
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";

  const name = (err as { name?: string } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "notFound";
  return "failed";
}
