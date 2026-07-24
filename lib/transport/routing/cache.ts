import "server-only";
import { db } from "@/lib/db";
import type { LatLng, RoutingMatrix, RouteResult, RoutingProvider } from "./types";

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** Matrix cache key: provider + profile + the sorted, 5-dp-rounded point set.
 *  Coordinate changes therefore miss automatically (spec §12). */
function matrixKey(provider: string, profile: string, points: LatLng[]): string {
  const pts = points.map((p) => `${round5(p.lat)},${round5(p.lng)}`).join("|");
  return `m:${provider}:${profile}:${pts}`;
}

/**
 * Caches a provider's matrix results in the RoutingCache table (spec §12).
 * Failed / fallback / incomplete matrices are never cached as authoritative.
 */
export class CachedRoutingProvider implements RoutingProvider {
  readonly name: string;
  constructor(
    private inner: RoutingProvider,
    private profile: string,
    private ttlSeconds: number,
  ) {
    this.name = inner.name;
  }

  async getMatrix(points: LatLng[]): Promise<RoutingMatrix> {
    const key = matrixKey(this.inner.name, this.profile, points);
    const now = new Date();
    const hit = await db.routingCache.findUnique({ where: { cacheKey: key } }).catch(() => null);
    if (hit && hit.expiresAt > now) {
      try {
        return JSON.parse(hit.payload) as RoutingMatrix;
      } catch {
        // corrupt row — fall through and refetch
      }
    }
    const res = await this.inner.getMatrix(points);
    if (!res.fallbackUsed && !res.warnings.includes("MATRIX_DATA_INCOMPLETE")) {
      const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);
      await db.routingCache
        .upsert({
          where: { cacheKey: key },
          create: { cacheKey: key, provider: this.inner.name, profile: this.profile, payload: JSON.stringify(res), expiresAt },
          update: { payload: JSON.stringify(res), expiresAt },
        })
        .catch(() => {});
    }
    return res;
  }

  getRouteThroughStops(stops: LatLng[]): Promise<RouteResult> {
    return this.inner.getRouteThroughStops(stops);
  }
  healthCheck(): Promise<boolean> {
    return this.inner.healthCheck();
  }
}
