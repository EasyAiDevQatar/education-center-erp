import "server-only";
import { decryptSecret } from "./secret-crypto";
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
    // Stored encrypted; a value written before that was true reads back as the
    // clear text it is, and is re-encrypted the next time settings are saved.
    apiKey: row.apiKey ? decryptSecret(row.apiKey) : null,
    config: parseJson<Record<string, string>>(row.config, {}),
    events: parseJson<IntegrationEvent[]>(row.events, []).filter((e) =>
      (INTEGRATION_EVENTS as readonly string[]).includes(e),
    ),
    audiences: parseJson<Audience[]>(row.audiences, []).filter((a) =>
      (AUDIENCES as readonly string[]).includes(a),
    ),
    matrix: resolveMatrix(row.deliveryMatrix, row.events, row.audiences),
  };
}

/**
 * Who hears about what.
 *
 * A stored matrix wins. Without one the old columns are expanded into the
 * cross product they always meant, which is what keeps an existing setup
 * sending exactly what it sent yesterday.
 */
function resolveMatrix(
  stored: string | null,
  events: string | null,
  audiences: string | null,
): Record<string, Audience[]> {
  const valid = (list: unknown): Audience[] =>
    Array.isArray(list)
      ? (list.filter((a) => (AUDIENCES as readonly string[]).includes(a)) as Audience[])
      : [];

  const saved = parseJson<Record<string, unknown>>(stored, {});
  if (Object.keys(saved).length > 0) {
    const out: Record<string, Audience[]> = {};
    for (const [event, list] of Object.entries(saved)) {
      if (!(INTEGRATION_EVENTS as readonly string[]).includes(event)) continue;
      const people = valid(list);
      if (people.length) out[event] = people;
    }
    return out;
  }

  const everyone = valid(parseJson<unknown>(audiences, []));
  const out: Record<string, Audience[]> = {};
  for (const event of parseJson<string[]>(events, [])) {
    if ((INTEGRATION_EVENTS as readonly string[]).includes(event) && everyone.length) {
      out[event] = everyone;
    }
  }
  return out;
}

/** All enabled integrations that subscribe to a given event. */
export async function activeConfigsFor(event: IntegrationEvent): Promise<IntegrationConfig[]> {
  const rows = await db.integration.findMany({ where: { enabled: true } });
  const out: IntegrationConfig[] = [];
  for (const row of rows) {
    const cfg = await loadConfig(row.provider);
    // An event with nobody listening is not subscribed, whatever the old
    // events column happens to still say.
    if (cfg && (cfg.matrix[event] ?? []).length > 0) out.push(cfg);
  }
  return out;
}

/** Mask a secret for display, e.g. "cfat_abc…xyz". */
export function maskSecret(v: string | null | undefined): string {
  if (!v) return "";
  if (v.length <= 8) return "••••";
  return `${v.slice(0, 4)}••••${v.slice(-4)}`;
}
