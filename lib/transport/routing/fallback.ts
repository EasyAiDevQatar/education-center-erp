import { distanceMeters } from "@/lib/geo";
import type { LatLng, RoutingMatrix, RouteResult, RoutingProvider } from "./types";

/**
 * The straight-line estimator as a routing provider (spec §14). Wraps the same
 * maths lib/transport/eta.ts uses: haversine × road factor ÷ a nominal speed.
 * Every result is flagged `estimated`/`fallbackUsed` and carries the
 * TRAVEL_TIME_FALLBACK_USED warning so nothing downstream mistakes it for a
 * road-network result. Time-of-day (rush) is applied later by the operational
 * layer, so the matrix here is departure-agnostic.
 */
export class FallbackRoutingProvider implements RoutingProvider {
  readonly name = "fallback";
  constructor(
    private roadFactor = 1.35,
    private speedKmh = 40,
    private minSeconds = 60,
  ) {}

  private legSeconds(a: LatLng, b: LatLng): { s: number; m: number } {
    const straightKm = distanceMeters(a.lat, a.lng, b.lat, b.lng) / 1000;
    const roadKm = straightKm * this.roadFactor;
    const s = Math.max(this.minSeconds, Math.round((roadKm / this.speedKmh) * 3600));
    return { s, m: Math.round(roadKm * 1000) };
  }

  async getMatrix(points: LatLng[]): Promise<RoutingMatrix> {
    const n = points.length;
    const dur: (number | null)[][] = [];
    const dist: (number | null)[][] = [];
    for (let i = 0; i < n; i++) {
      dur[i] = [];
      dist[i] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) {
          dur[i][j] = 0;
          dist[i][j] = 0;
        } else {
          const { s, m } = this.legSeconds(points[i], points[j]);
          dur[i][j] = s;
          dist[i][j] = m;
        }
      }
    }
    return {
      durationsSeconds: dur,
      distancesMeters: dist,
      provider: this.name,
      estimated: true,
      fallbackUsed: true,
      warnings: ["TRAVEL_TIME_FALLBACK_USED"],
    };
  }

  async getRouteThroughStops(stops: LatLng[]): Promise<RouteResult> {
    let s = 0;
    let m = 0;
    for (let i = 0; i < stops.length - 1; i++) {
      const leg = this.legSeconds(stops[i], stops[i + 1]);
      s += leg.s;
      m += leg.m;
    }
    return {
      durationSeconds: s,
      distanceMeters: m,
      geometry: null,
      provider: this.name,
      calculatedAt: new Date().toISOString(),
      estimated: true,
      fallbackUsed: true,
      warnings: ["TRAVEL_TIME_FALLBACK_USED"],
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
