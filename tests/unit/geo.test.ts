import { describe, expect, it } from "vitest";
import { distanceMeters, GEOFENCE_RADIUS_M } from "@/lib/geo";

// Reference points around Doha, where the centre operates.
const CENTRE = { lat: 25.2854, lng: 51.531 };
const WEST_BAY = { lat: 25.3213, lng: 51.5309 };

describe("distanceMeters", () => {
  it("is zero for the same point", () => {
    expect(distanceMeters(CENTRE.lat, CENTRE.lng, CENTRE.lat, CENTRE.lng)).toBe(0);
  });

  it("is symmetric", () => {
    const there = distanceMeters(CENTRE.lat, CENTRE.lng, WEST_BAY.lat, WEST_BAY.lng);
    const back = distanceMeters(WEST_BAY.lat, WEST_BAY.lng, CENTRE.lat, CENTRE.lng);
    expect(there).toBe(back);
  });

  it("matches a known Doha distance (~4 km) within 2%", () => {
    // Straight-line centre → West Bay is almost exactly 4.0 km.
    const d = distanceMeters(CENTRE.lat, CENTRE.lng, WEST_BAY.lat, WEST_BAY.lng);
    expect(d).toBeGreaterThan(3920);
    expect(d).toBeLessThan(4080);
  });

  it("one degree of latitude is ~111 km anywhere", () => {
    const atEquator = distanceMeters(0, 0, 1, 0);
    const atDoha = distanceMeters(25, 51, 26, 51);
    expect(atEquator).toBeGreaterThan(110_500);
    expect(atEquator).toBeLessThan(111_500);
    // Latitude degrees are near-constant; longitude ones are not.
    expect(Math.abs(atDoha - atEquator)).toBeLessThan(1500);
  });

  it("a degree of longitude shrinks with latitude", () => {
    const equator = distanceMeters(0, 0, 0, 1);
    const doha = distanceMeters(25, 51, 25, 52);
    expect(doha).toBeLessThan(equator);
    // cos(25°) ≈ 0.906
    expect(doha / equator).toBeCloseTo(Math.cos((25 * Math.PI) / 180), 2);
  });

  it("handles antipodal points without NaN", () => {
    const d = distanceMeters(0, 0, 0, 180);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(20_000_000);
  });

  it("returns whole metres", () => {
    const d = distanceMeters(CENTRE.lat, CENTRE.lng, WEST_BAY.lat, WEST_BAY.lng);
    expect(Number.isInteger(d)).toBe(true);
  });

  it("a geofence radius rejects a point clearly outside it", () => {
    // ~1 km away must never pass a 300 m geofence.
    const far = distanceMeters(CENTRE.lat, CENTRE.lng, CENTRE.lat + 0.009, CENTRE.lng);
    expect(far).toBeGreaterThan(GEOFENCE_RADIUS_M);
  });
});
