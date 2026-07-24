import "server-only";
import type { LatLng, RoutingMatrix, RouteResult, RoutingProvider } from "./types";

/**
 * OSRM provider — the self-hosted road-network engine (spec §9). Uses the Table
 * service for the many-to-many matrix and the Route service for final geometry.
 * Bound to a private OSRM_BASE_URL (never a public endpoint hard-coded in
 * business logic, spec §3). A missing matrix cell stays null, never zero.
 */
export class OsrmRoutingProvider implements RoutingProvider {
  readonly name = "osrm";
  constructor(
    private baseUrl: string,
    private profile = "driving",
    private timeoutMs = 8000,
    private maxRetries = 1,
  ) {}

  private coords(points: LatLng[]): string {
    // OSRM wants lng,lat pairs, semicolon-separated.
    return points.map((p) => `${p.lng},${p.lat}`).join(";");
  }

  private async fetchJson(url: string): Promise<any> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`OSRM ${res.status}`);
        const json = await res.json();
        if (json.code && json.code !== "Ok") throw new Error(`OSRM ${json.code}`);
        return json;
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        if (attempt < this.maxRetries) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  async getMatrix(points: LatLng[]): Promise<RoutingMatrix> {
    const url = `${this.baseUrl}/table/v1/${this.profile}/${this.coords(points)}?annotations=duration,distance`;
    const json = await this.fetchJson(url);
    const warnings: string[] = [];
    const dur: (number | null)[][] = (json.durations ?? []).map((row: (number | null)[]) =>
      row.map((v) => (v == null ? null : Math.round(v))),
    );
    const dist: (number | null)[][] = (json.distances ?? []).map((row: (number | null)[]) =>
      row.map((v) => (v == null ? null : Math.round(v))),
    );
    // Flag any unreachable cell so callers can fall back explicitly (spec §10).
    if (dur.some((r) => r.some((v) => v == null))) warnings.push("MATRIX_DATA_INCOMPLETE");
    return {
      durationsSeconds: dur,
      distancesMeters: dist,
      provider: this.name,
      estimated: false,
      fallbackUsed: false,
      warnings,
    };
  }

  async getRouteThroughStops(stops: LatLng[]): Promise<RouteResult> {
    const url = `${this.baseUrl}/route/v1/${this.profile}/${this.coords(stops)}?overview=full&geometries=polyline`;
    const json = await this.fetchJson(url);
    const route = json.routes?.[0];
    return {
      durationSeconds: Math.round(route?.duration ?? 0),
      distanceMeters: Math.round(route?.distance ?? 0),
      geometry: route?.geometry ?? null,
      provider: this.name,
      calculatedAt: new Date().toISOString(),
      estimated: false,
      fallbackUsed: false,
      warnings: [],
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      // A trivial 1-point table is the cheapest liveness probe.
      await this.fetchJson(`${this.baseUrl}/table/v1/${this.profile}/0,0`);
      return true;
    } catch {
      return false;
    }
  }
}
