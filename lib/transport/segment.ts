// Split one passenger's ordered day into direction-coherent trips (spec §5-ish,
// user request C4). Pure module (no imports) so the segmentation rule is
// unit-tested, never guessed.
//
// The centre is the pivot. A run of stops that ENDS at the centre is a delivery
// to the centre (PICKUP / رحلة توصيل); a run that LEAVES the centre is a return
// (RETURN / رحلة عودة). A run that both starts and ends at the centre is a field
// round (CHAIN), and a day that never touches the centre stays one CHAIN trip.
// The centre stop is shared: it is the end of the inbound trip and the start of
// the outbound one, so no stop is lost across the cut.

export type SegmentKind = "PICKUP" | "RETURN" | "CHAIN";

export type LL = { lat: number; lng: number };

/** ~50 m — the same tolerance the rest of the module treats as "same place". */
const TOL = 0.0005;

/**
 * Segment `items` (already in visit order) at every centre visit.
 * Returns [] for fewer than two stops (no trip to make).
 */
export function segmentByCentre<T>(
  items: T[],
  coordOf: (t: T) => LL,
  centre: LL | null,
  tolDeg = TOL,
): { kind: SegmentKind; items: T[] }[] {
  if (items.length < 2) return [];
  const isCentre = (t: T): boolean => {
    if (!centre) return false;
    const p = coordOf(t);
    return Math.abs(p.lat - centre.lat) < tolDeg && Math.abs(p.lng - centre.lng) < tolDeg;
  };

  const centreIdx = items.map((t, i) => (isCentre(t) ? i : -1)).filter((i) => i >= 0);
  // No centre in the day → nothing to pivot on; the whole run is one trip.
  if (!centre || centreIdx.length === 0) return [{ kind: "CHAIN", items }];

  // Boundaries are the first stop, every centre visit, and the last stop.
  const bounds = [...new Set([0, ...centreIdx, items.length - 1])].sort((a, b) => a - b);
  const segs: { kind: SegmentKind; items: T[] }[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    // Inclusive of both boundary stops, so the centre is shared across the cut.
    const seg = items.slice(bounds[i], bounds[i + 1] + 1);
    if (seg.length < 2) continue;
    const startsCentre = isCentre(seg[0]);
    const endsCentre = isCentre(seg[seg.length - 1]);
    const kind: SegmentKind =
      startsCentre && endsCentre
        ? "CHAIN"
        : endsCentre
          ? "PICKUP"
          : startsCentre
            ? "RETURN"
            : "CHAIN";
    segs.push({ kind, items: seg });
  }
  return segs.length ? segs : [{ kind: "CHAIN", items }];
}
