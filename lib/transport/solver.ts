import "server-only";
import type { Assignment } from "./allocate";

/**
 * VRPTW solver client — the optional OR-Tools sidecar (spec §15).
 *
 * The greedy allocator in `allocate.ts` is the DEFAULT and the fallback: it is
 * instant, deterministic and explainable. This module is a thin, flag-guarded
 * client for an external solver that can find a better global assignment when a
 * centre runs enough vehicles for the greedy pass to leave value on the table.
 *
 * Contract: `solveVrptw` returns `null` — never throws — whenever the solver is
 * disabled, unreachable, times out, or replies with anything but a clean result.
 * A null return means "use the greedy allocator", so the planner degrades to the
 * exact behaviour it has today. The seam is env-only (spec §8): business logic
 * never reads SOLVER_URL, it just calls this and handles null.
 */

export type SolveStop = {
  /** Stable id echoed back so the caller can map results to its own legs. */
  id: string;
  /** Index into the duration matrix rows/cols for this stop. */
  node: number;
  /** Earliest / latest service minute (from midnight) — the time window. */
  earliestMin: number;
  latestMin: number;
  /** Seats this stop consumes (+) or frees; +passengers on pickup. */
  demand: number;
};

export type SolveVehicle = {
  id: string;
  capacity: number;
  /** Node the vehicle starts and ends at (usually the centre / its depot). */
  startNode: number;
  endNode: number;
  shiftStartMin: number;
  shiftEndMin: number;
};

export type SolveRequest = {
  /** Asymmetric duration matrix in SECONDS; `null` = unreachable, never 0. */
  durationMatrix: (number | null)[][];
  stops: SolveStop[];
  vehicles: SolveVehicle[];
  /** Hard wall-clock cap for the solver, seconds (spec §15). */
  solverTimeoutSeconds: number;
};

export type SolveRoute = { vehicleId: string; stopIds: string[]; arrivalMin: number[] };
export type SolveResult = { routes: SolveRoute[]; dropped: string[]; provider: "ortools" };

function solverEnv() {
  return {
    url: process.env.SOLVER_URL, // unset → disabled → greedy
    enabled: process.env.SOLVER_ENABLED === "1" && !!process.env.SOLVER_URL,
    timeoutMs: Number(process.env.SOLVER_REQUEST_TIMEOUT_MS ?? 15000),
  };
}

/** True when an OR-Tools sidecar is configured and switched on. */
export function solverEnabled(): boolean {
  return solverEnv().enabled;
}

/**
 * Ask the sidecar to solve one planning scope. Returns null (→ greedy) on any
 * problem; the caller must have a working allocation without it.
 */
export async function solveVrptw(req: SolveRequest): Promise<SolveResult | null> {
  const e = solverEnv();
  if (!e.enabled || !e.url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), e.timeoutMs);
  try {
    const res = await fetch(`${e.url}/solve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<SolveResult>;
    if (!json || !Array.isArray(json.routes)) return null;
    return { routes: json.routes, dropped: json.dropped ?? [], provider: "ortools" };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/** Liveness probe for the sidecar (used by ops/health, never in the hot path). */
export async function solverHealthy(): Promise<boolean> {
  const e = solverEnv();
  if (!e.url) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`${e.url}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

/** Re-export so the eventual buildDayPlan wiring imports one symbol shape. */
export type { Assignment };
