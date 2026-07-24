import { describe, it, expect } from "vitest";
import { bestInsertion, poolCandidates } from "@/lib/transport/pooling";

// A flat "manhattan-ish" distance is enough to test the geometry deterministically.
const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.abs(a.lat - b.lat) + Math.abs(a.lng - b.lng);

const P = (lat: number, lng: number) => ({ lat, lng });

describe("bestInsertion", () => {
  it("returns a zero detour for an empty route", () => {
    expect(bestInsertion([], P(1, 1), dist)).toEqual({ afterSeq: 0, detourKm: 0 });
  });

  it("slots a point into the cheapest gap", () => {
    // Route along a line 0→10; a point at 5 sits exactly between stops 1 and 2.
    const route = [P(0, 0), P(0, 10)];
    const r = bestInsertion(route, P(0, 5), dist);
    expect(r.afterSeq).toBe(1); // after the first stop
    expect(r.detourKm).toBeCloseTo(0); // straight on the line, no detour
  });

  it("prepends when the point precedes the whole route", () => {
    const route = [P(0, 5), P(0, 10)];
    const r = bestInsertion(route, P(0, 0), dist);
    expect(r.afterSeq).toBe(0);
  });

  it("appends when the point follows the whole route", () => {
    const route = [P(0, 0), P(0, 5)];
    const r = bestInsertion(route, P(0, 10), dist);
    expect(r.afterSeq).toBe(2);
  });

  it("charges the real detour for an off-route point", () => {
    const route = [P(0, 0), P(0, 10)];
    // A point 3 units off the line between the two stops.
    const r = bestInsertion(route, P(3, 5), dist);
    expect(r.detourKm).toBeCloseTo(6); // 3 out + 3 back
  });
});

describe("poolCandidates", () => {
  const route = [P(0, 0), P(0, 10)];
  const items = [
    { item: "onLine", point: P(0, 5) }, // detour 0
    { item: "nearby", point: P(2, 5) }, // detour 4
    { item: "faraway", point: P(20, 5) }, // detour 40
  ];

  it("keeps only points within the detour budget, cheapest first", () => {
    const r = poolCandidates(route, items, dist, 6);
    expect(r.map((c) => c.item)).toEqual(["onLine", "nearby"]);
    expect(r[0].detourKm).toBeLessThanOrEqual(r[1].detourKm);
  });

  it("excludes everyone when the budget is zero except exact-on-route", () => {
    const r = poolCandidates(route, items, dist, 0);
    expect(r.map((c) => c.item)).toEqual(["onLine"]);
  });

  it("is deterministic across runs", () => {
    const a = poolCandidates(route, items, dist, 50);
    const b = poolCandidates(route, items, dist, 50);
    expect(a).toEqual(b);
  });
});
