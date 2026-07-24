import { describe, it, expect } from "vitest";
import { segmentByCentre } from "@/lib/transport/segment";

const CENTRE = { lat: 25.3, lng: 51.5 };
const HOME_A = { lat: 25.4, lng: 51.6 };
const HOME_B = { lat: 25.2, lng: 51.4 };
const coord = (p: { lat: number; lng: number }) => p;

describe("segmentByCentre (C4 pickup/return split)", () => {
  it("no centre in the day → one CHAIN trip", () => {
    const segs = segmentByCentre([HOME_A, HOME_B], coord, CENTRE);
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe("CHAIN");
  });

  it("home → centre → home → PICKUP then RETURN", () => {
    const segs = segmentByCentre([HOME_A, CENTRE, HOME_A], coord, CENTRE);
    expect(segs.map((s) => s.kind)).toEqual(["PICKUP", "RETURN"]);
    // The centre is shared across the cut, so no stop is dropped.
    expect(segs[0].items).toEqual([HOME_A, CENTRE]);
    expect(segs[1].items).toEqual([CENTRE, HOME_A]);
  });

  it("home → field lesson → centre → home → still PICKUP then RETURN", () => {
    const segs = segmentByCentre([HOME_A, HOME_B, CENTRE, HOME_A], coord, CENTRE);
    expect(segs.map((s) => s.kind)).toEqual(["PICKUP", "RETURN"]);
    expect(segs[0].items).toEqual([HOME_A, HOME_B, CENTRE]);
  });

  it("multi-centre day → PICKUP, CHAIN (centre→…→centre), RETURN", () => {
    const segs = segmentByCentre([HOME_A, CENTRE, HOME_B, CENTRE, HOME_A], coord, CENTRE);
    expect(segs.map((s) => s.kind)).toEqual(["PICKUP", "CHAIN", "RETURN"]);
  });

  it("fewer than two stops → no trip", () => {
    expect(segmentByCentre([HOME_A], coord, CENTRE)).toEqual([]);
    expect(segmentByCentre([], coord, CENTRE)).toEqual([]);
  });

  it("null centre → one CHAIN trip", () => {
    const segs = segmentByCentre([HOME_A, HOME_B], coord, null);
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe("CHAIN");
  });
});
