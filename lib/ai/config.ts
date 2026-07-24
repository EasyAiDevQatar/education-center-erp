import "server-only";
import { db } from "@/lib/db";
import { STAFF_ROLES } from "@/lib/rbac";
import { maskSecret } from "@/lib/integrations/registry";
import {
  isAiProvider,
  parseAssistantRoles,
  resolveEndpoint,
  type AiProvider,
} from "./presets";

export type AiConfig = {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  /** Server-side only — never send to the client; display via maskSecret. */
  apiKey: string;
  dialect: "openai" | "anthropic";
  autoTranslateNames: boolean;
  /** Show the floating chat bubble on every staff page. */
  floatingChat: boolean;
  /** Roles allowed to see/use the assistant (always includes ADMIN). */
  assistantRoles: string[];
};

const KEYS = [
  "aiEnabled",
  "aiProvider",
  "aiBaseUrl",
  "aiApiKey",
  "aiModel",
  "aiAutoTranslateNames",
  "aiFloatingChat",
  "aiAssistantRoles",
] as const;

export async function loadAiConfig(): Promise<AiConfig> {
  const rows = await db.setting.findMany({ where: { key: { in: [...KEYS] } } });
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const provider = isAiProvider(s.aiProvider ?? "") ? (s.aiProvider as AiProvider) : "deepseek";
  const ep = resolveEndpoint(provider, s.aiBaseUrl, s.aiModel);
  return {
    enabled: s.aiEnabled === "1",
    provider,
    baseUrl: ep.baseUrl,
    model: ep.model,
    apiKey: s.aiApiKey ?? "",
    dialect: ep.dialect,
    autoTranslateNames: s.aiAutoTranslateNames === "1",
    floatingChat: s.aiFloatingChat !== "0", // default ON once the module is enabled
    assistantRoles: parseAssistantRoles(s.aiAssistantRoles, STAFF_ROLES),
  };
}

/** Configured well enough to actually make a call. */
export function aiReady(cfg: AiConfig): boolean {
  return cfg.enabled && !!cfg.apiKey && !!cfg.baseUrl && !!cfg.model;
}

/**
 * The distinct AI "uses" an admin can point at a different model/provider/key.
 * Each falls back to the default configuration above unless overridden.
 */
export const AI_USES = ["assistant", "translation", "briefing"] as const;
export type AiUse = (typeof AI_USES)[number];

const USE_FIELDS = ["override", "provider", "model", "baseUrl", "apiKey"] as const;

/** Setting key for a per-use override field, e.g. aiUse_assistant_model. */
export function aiUseSettingKey(use: AiUse, field: (typeof USE_FIELDS)[number]): string {
  return `aiUse_${use}_${field}`;
}

/**
 * Load the effective config for one use. When its override is off, this is the
 * global default verbatim; when on, the use's own provider/model/baseUrl/key
 * take over. An empty per-use key reuses the default key (handy when the same
 * provider is billed on one account), and enabled/roles/toggles always come
 * from the default so a use can't be turned on independently of the module.
 */
export async function loadAiConfigFor(use: AiUse): Promise<AiConfig> {
  const base = await loadAiConfig();
  const keys = USE_FIELDS.map((f) => aiUseSettingKey(use, f));
  const rows = await db.setting.findMany({ where: { key: { in: keys } } });
  const s = Object.fromEntries(rows.map((r) => [r.key.split("_").pop()!, r.value]));
  if (s.override !== "1") return base;

  const provider = isAiProvider(s.provider ?? "") ? (s.provider as AiProvider) : base.provider;
  const ep = resolveEndpoint(provider, s.baseUrl, s.model);
  const apiKey = (s.apiKey ?? "").trim() || base.apiKey;
  return { ...base, provider, baseUrl: ep.baseUrl, model: ep.model, apiKey, dialect: ep.dialect };
}

export type AiUseView = {
  use: AiUse;
  override: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyMask: string;
};

/** Per-use override values for the settings UI (key masked, never raw). */
export async function loadAiUseSettings(): Promise<AiUseView[]> {
  const allKeys = AI_USES.flatMap((u) => USE_FIELDS.map((f) => aiUseSettingKey(u, f)));
  const rows = await db.setting.findMany({ where: { key: { in: allKeys } } });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return AI_USES.map((use) => ({
    use,
    override: map[aiUseSettingKey(use, "override")] === "1",
    provider: map[aiUseSettingKey(use, "provider")] ?? "",
    model: map[aiUseSettingKey(use, "model")] ?? "",
    baseUrl: map[aiUseSettingKey(use, "baseUrl")] ?? "",
    apiKeyMask: maskSecret(map[aiUseSettingKey(use, "apiKey")]),
  }));
}
