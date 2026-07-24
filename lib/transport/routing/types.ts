// Routing-provider abstraction — the seam between the transport domain and
// whatever computes road distances. Business logic depends on this interface,
// never on an OSRM URL or response shape, so a future switch to Valhalla /
// GraphHopper / openrouteservice touches only the provider files (spec §8).

export type LatLng = { lat: number; lng: number };

/** A single road route between an ordered list of stops. */
export type RouteResult = {
  durationSeconds: number;
  distanceMeters: number;
  /** Encoded polyline (OSRM geometry) or null for the estimator. */
  geometry: string | null;
  provider: string;
  calculatedAt: string;
  estimated: boolean;
  fallbackUsed: boolean;
  warnings: string[];
};

/**
 * Many-to-many road matrix. `durationsSeconds[from][to]` — a null cell is an
 * explicit "no value" (spec §10): callers must never treat it as zero and must
 * mark any substitute as fallback.
 */
export type RoutingMatrix = {
  durationsSeconds: (number | null)[][];
  distancesMeters: (number | null)[][];
  provider: string;
  estimated: boolean;
  fallbackUsed: boolean;
  warnings: string[];
};

export interface RoutingProvider {
  readonly name: string;
  /** Duration + distance matrix over `points` (indices preserved). */
  getMatrix(points: LatLng[]): Promise<RoutingMatrix>;
  /** Final geometry + totals for a chosen ordered route (for Leaflet). */
  getRouteThroughStops(stops: LatLng[]): Promise<RouteResult>;
  healthCheck(): Promise<boolean>;
}
