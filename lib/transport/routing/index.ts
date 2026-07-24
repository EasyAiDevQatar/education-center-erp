import "server-only";
import { FallbackRoutingProvider } from "./fallback";
import { OsrmRoutingProvider } from "./osrm";
import { CachedRoutingProvider } from "./cache";
import type { LatLng, RoutingMatrix, RoutingProvider } from "./types";

export type { LatLng, RoutingMatrix, RouteResult, RoutingProvider } from "./types";

/** Routing configuration from the environment (never read in business logic —
 *  only here, spec §8). */
function routingEnv() {
  return {
    provider: process.env.ROUTING_PROVIDER ?? "fallback",
    osrmBaseUrl: process.env.OSRM_BASE_URL,
    profile: process.env.OSRM_PROFILE ?? "driving",
    timeoutMs: Number(process.env.OSRM_REQUEST_TIMEOUT_MS ?? 8000),
    maxRetries: Number(process.env.OSRM_MAX_RETRIES ?? 1),
    cacheTtlSeconds: Number(process.env.ROUTING_CACHE_TTL_SECONDS ?? 86400),
    fallbackSpeedKmh: Number(process.env.ROUTING_FALLBACK_SPEED_KMH ?? 40),
    fallbackRoadFactor: Number(process.env.ROUTING_FALLBACK_ROAD_FACTOR ?? 1.35),
  };
}

export function getFallbackProvider(): RoutingProvider {
  const e = routingEnv();
  return new FallbackRoutingProvider(e.fallbackRoadFactor, e.fallbackSpeedKmh);
}

/** The configured provider (OSRM + cache when set, else the estimator). */
export function getRoutingProvider(): RoutingProvider {
  const e = routingEnv();
  if (e.provider === "osrm" && e.osrmBaseUrl) {
    const osrm = new OsrmRoutingProvider(e.osrmBaseUrl, e.profile, e.timeoutMs, e.maxRetries);
    return new CachedRoutingProvider(osrm, e.profile, e.cacheTtlSeconds);
  }
  return getFallbackProvider();
}

/**
 * Get a road matrix, degrading to the estimator on ANY OSRM failure or missing
 * cell — and saying so. The returned matrix's `fallbackUsed` flag is what the
 * validator uses to downgrade a trip to WARNING (spec §14), so callers must
 * propagate it to the stored stops.
 */
export async function getMatrixWithFallback(points: LatLng[]): Promise<RoutingMatrix> {
  const provider = getRoutingProvider();
  if (provider.name === "fallback" || points.length === 0) {
    return getFallbackProvider().getMatrix(points);
  }
  try {
    const m = await provider.getMatrix(points);
    if (m.warnings.includes("MATRIX_DATA_INCOMPLETE")) {
      const fb = await getFallbackProvider().getMatrix(points);
      for (let i = 0; i < m.durationsSeconds.length; i++) {
        for (let j = 0; j < m.durationsSeconds[i].length; j++) {
          if (m.durationsSeconds[i][j] == null) {
            m.durationsSeconds[i][j] = fb.durationsSeconds[i][j];
            m.distancesMeters[i][j] = fb.distancesMeters[i][j];
          }
        }
      }
      m.fallbackUsed = true;
      if (!m.warnings.includes("TRAVEL_TIME_FALLBACK_USED")) m.warnings.push("TRAVEL_TIME_FALLBACK_USED");
    }
    return m;
  } catch {
    const fb = await getFallbackProvider().getMatrix(points);
    fb.warnings.push("ROUTING_PROVIDER_UNAVAILABLE");
    return fb;
  }
}
