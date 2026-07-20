import "server-only";
import { db } from "@/lib/db";
import type { Provider, IntegrationConfig, IntegrationEvent, Audience } from "./types";
import { INTEGRATION_EVENTS, AUDIENCES } from "./types";
import { easyAiConnect } from "./easyaiconnect";

/** Add new integrations here — the Settings UI renders them automatically. */
export const PROVIDERS: Provider[] = [easyAiConnect];

export function getProvider(key: string): Provider | undefined {
  return PROVIDERS.find((p) => p.key === key);
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Load one provider's stored configuration (including secrets — server only). */
export async function loadConfig(provider: string): Promise<IntegrationConfig | null> {
  const row = await db.integration.findUnique({ where: { provider } });
  if (!row) return null;
  return {
    provider: row.provider,
    enabled: row.enabled,
    baseUrl: row.baseUrl,
    apiKey: row.apiKey,
    config: parseJson<Record<string, string>>(row.config, {}),
    events: parseJson<IntegrationEvent[]>(row.events, []).filter((e) =>
      (INTEGRATION_EVENTS as readonly string[]).includes(e),
    ),
    audiences: parseJson<Audience[]>(row.audiences, []).filter((a) =>
      (AUDIENCES as readonly string[]).includes(a),
    ),
  };
}

/** All enabled integrations that subscribe to a given event. */
export async function activeConfigsFor(event: IntegrationEvent): Promise<IntegrationConfig[]> {
  const rows = await db.integration.findMany({ where: { enabled: true } });
  const out: IntegrationConfig[] = [];
  for (const row of rows) {
    const cfg = await loadConfig(row.provider);
    if (cfg && cfg.events.includes(event)) out.push(cfg);
  }
  return out;
}

/** Mask a secret for display, e.g. "cfat_abc…xyz". */
export function maskSecret(v: string | null | undefined): string {
  if (!v) return "";
  if (v.length <= 8) return "••••";
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}
