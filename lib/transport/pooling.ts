// Ride-pooling geometry: who can a driver pick up or drop "on the way".
//
// Pure module (an injected distance function keeps it testable, like allocate.ts
// and eta.ts). The rule is the cheap-insertion heuristic every route planner
// uses: adding a point P between two consecutive stops A and B costs the detour
// dist(A,P) + dist(P,B) − dist(A,B). The best place to slot P in is the gap
// (or either end) where that detour is smallest; if even that is small, P is
// genuinely on the way and worth pooling into the trip.

export type RoutePoint = { lat: number; lng: number };
export type Insertion = { afterSeq: number; detourKm: number };

/**
 * Cheapest place to insert `p` into an ordered `route`.
 *
 * `afterSeq` is the 1-based seq of the stop the new one should follow — 0 means
 * before the first stop, route.length means append at the end. `detourKm` is
 * the extra distance the insertion adds (0 for an empty route).
 */
export function bestInsertion(
  route: RoutePoint[],
  p: RoutePoint,
  distanceKm: (a: RoutePoint, b: RoutePoint) => number,
): Insertion {
  if (route.length === 0) return { afterSeq: 0, detourKm: 0 };

  // Prepend and append are the two open ends; a detour there is just the single
  // hop to (or from) the terminal stop.
  let best: Insertion = { afterSeq: 0, detourKm: round(distanceKm(p, route[0])) };
  const appendKm = round(distanceKm(route[route.length - 1], p));
  if (appendKm < best.detourKm) best = { afterSeq: route.length, detourKm: appendKm };

  for (let i = 0; i < route.length - 1; i++) {
    const detour = round(
      distanceKm(route[i], p) + distanceKm(p, route[i + 1]) - distanceKm(route[i], route[i + 1]),
    );
    if (detour < best.detourKm) best = { afterSeq: i + 1, detourKm: detour };
  }
  return best;
}

export type PoolCandidate<T> = { item: T; afterSeq: number; detourKm: number };

/**
 * Of `items`, those a driver on `route` could pick up/drop within `maxDetourKm`,
 * cheapest detour first. Deterministic: ties break on the pre-computed detour
 * then input order, so the board never reshuffles between runs.
 */
export function poolCandidates<T>(
  route: RoutePoint[],
  items: { item: T; point: RoutePoint }[],
  distanceKm: (a: RoutePoint, b: RoutePoint) => number,
  maxDetourKm = 6,
): PoolCandidate<T>[] {
  return items
    .map(({ item, point }) => {
      const ins = bestInsertion(route, point, distanceKm);
      return { item, afterSeq: ins.afterSeq, detourKm: ins.detourKm };
    })
    .filter((c) => c.detourKm <= maxDetourKm)
    .sort((a, b) => a.detourKm - b.detourKm);
}

const round = (n: number) => Math.round(n * 100) / 100;
