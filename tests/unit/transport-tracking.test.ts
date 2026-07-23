import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRACKING_POLICY,
  metresBetween,
  pingCutoff,
  shouldSendPing,
  type Fix,
} from "@/lib/transport/tracking";

const P = DEFAULT_TRACKING_POLICY;
const T0 = 1_700_000_000_000;
const fix = (over: Partial<Fix> = {}): Fix => ({
  lat: 25.2854,
  lng: 51.531,
  accuracyM: 10,
  at: T0,
  ...over,
});

/** ~0.001° of latitude is ~111 m. */
const northBy = (deg: number, over: Partial<Fix> = {}) =>
  fix({ lat: 25.2854 + deg, ...over });

describe("metresBetween", () => {
  it("measures a known short distance", () => {
    // 0.001° latitude ≈ 111 m anywhere on Earth.
    expect(metresBetween(fix(), northBy(0.001))).toBeGreaterThan(105);
    expect(metresBetween(fix(), northBy(0.001))).toBeLessThan(115);
  });

  it("is zero for the same point and symmetric", () => {
    expect(metresBetween(fix(), fix())).toBe(0);
    const a = fix();
    const b = northBy(0.01);
    expect(metresBetween(a, b)).toBeCloseTo(metresBetween(b, a), 6);
  });
});

describe("shouldSendPing — accuracy filter", () => {
  it("rejects a fix the device itself calls vague", () => {
    // The ported implementation had no filter, so a cell-tower fix drew a
    // confident line through streets the car never took.
    const d = shouldSendPing(fix({ accuracyM: 2000 }), null, P);
    expect(d).toEqual({ send: false, reason: "inaccurate" });
  });

  it("accepts a fix exactly at the accuracy ceiling", () => {
    expect(shouldSendPing(fix({ accuracyM: P.maxAccuracyM }), null, P).send).toBe(true);
  });

  it("accepts a fix with no accuracy reported", () => {
    expect(shouldSendPing(fix({ accuracyM: null }), null, P).send).toBe(true);
    expect(shouldSendPing(fix({ accuracyM: undefined }), null, P).send).toBe(true);
  });

  it("rejects an inaccurate fix even when it is the first one", () => {
    expect(shouldSendPing(fix({ accuracyM: 500 }), null, P).send).toBe(false);
  });
});

describe("shouldSendPing — coordinate sanity", () => {
  it("rejects impossible coordinates", () => {
    expect(shouldSendPing(fix({ lat: 91 }), null, P).reason).toBe("invalid");
    expect(shouldSendPing(fix({ lng: -181 }), null, P).reason).toBe("invalid");
    expect(shouldSendPing(fix({ lat: Number.NaN }), null, P).reason).toBe("invalid");
  });
});

describe("shouldSendPing — throttling", () => {
  it("always sends the first fix of a trip", () => {
    expect(shouldSendPing(fix(), null, P)).toEqual({ send: true, reason: "first" });
  });

  it("suppresses a stationary fix inside the interval", () => {
    const last = fix();
    const soon = fix({ at: T0 + 5_000 });
    expect(shouldSendPing(soon, last, P)).toEqual({ send: false, reason: "tooSoon" });
  });

  it("sends once the interval has elapsed, even parked", () => {
    const last = fix();
    const later = fix({ at: T0 + P.minIntervalMs });
    expect(shouldSendPing(later, last, P)).toEqual({ send: true, reason: "interval" });
  });

  it("sends early when the driver has moved far enough", () => {
    // A car crossing town must not wait out the interval; the ported code
    // throttled purely on time and lost the shape of the route.
    const last = fix();
    const moved = northBy(0.001, { at: T0 + 1_000 }); // ~111 m in 1 s
    expect(shouldSendPing(moved, last, P)).toEqual({ send: true, reason: "distance" });
  });

  it("does not send for a small jitter inside the interval", () => {
    const last = fix();
    const jitter = northBy(0.0001, { at: T0 + 1_000 }); // ~11 m
    expect(shouldSendPing(jitter, last, P).send).toBe(false);
  });

  it("honours a custom policy", () => {
    const strict = { minIntervalMs: 1000, minDistanceM: 5, maxAccuracyM: 20 };
    const last = fix();
    expect(shouldSendPing(northBy(0.0001, { at: T0 + 100 }), last, strict).send).toBe(true);
    expect(shouldSendPing(fix({ accuracyM: 50, at: T0 + 5000 }), last, strict).send).toBe(false);
  });
});

describe("shouldSendPing — retry semantics", () => {
  it("keeps offering the same fix while the caller's cursor has not advanced", () => {
    // The caller advances `lastSent` only AFTER a successful write. If a write
    // fails and the cursor stays put, the next fix must still be sendable —
    // the ported code advanced first and silently dropped both.
    const last = fix();
    const attempt = fix({ at: T0 + P.minIntervalMs });
    expect(shouldSendPing(attempt, last, P).send).toBe(true);
    // Write failed → cursor unchanged → a later fix is still sendable.
    const retry = fix({ at: T0 + P.minIntervalMs + 1_000 });
    expect(shouldSendPing(retry, last, P).send).toBe(true);
  });

  it("suppresses only once the cursor really moves", () => {
    const last = fix();
    const written = fix({ at: T0 + P.minIntervalMs });
    expect(shouldSendPing(written, last, P).send).toBe(true);
    // Now the write succeeded and the cursor advanced.
    expect(shouldSendPing(fix({ at: written.at + 1_000 }), written, P).send).toBe(false);
  });
});

describe("pingCutoff", () => {
  const now = new Date("2026-07-23T10:30:00.000Z");

  it("goes back the retention window", () => {
    expect(pingCutoff(now, 14).toISOString()).toBe("2026-07-09T10:30:00.000Z");
  });

  it("never prunes everything when given a silly value", () => {
    // A retention of 0 would delete the trip that is running right now.
    expect(pingCutoff(now, 0).toISOString()).toBe("2026-07-22T10:30:00.000Z");
    expect(pingCutoff(now, -5).toISOString()).toBe("2026-07-22T10:30:00.000Z");
  });
});
