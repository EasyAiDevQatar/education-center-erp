// Provider presets for the AI module. Pure module (no imports) — unit-tested.
//
// The module is deliberately provider-agnostic: the centre decides later which
// API to pay for and pastes one key into Settings. Everything but Anthropic
// speaks the OpenAI-compatible /chat/completions dialect; Anthropic uses its
// own /v1/messages shape (handled in lib/ai/client.ts).

export const AI_PROVIDERS = ["deepseek", "kimi", "openai", "anthropic", "custom"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export type ProviderPreset = {
  /** Base URL up to (not including) the endpoint path. */
  baseUrl: string;
  /** Sensible default model; editable in Settings. */
  model: string;
  /** Which wire dialect the provider speaks. */
  dialect: "openai" | "anthropic";
};

export const AI_PRESETS: Record<AiProvider, ProviderPreset> = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat", dialect: "openai" },
  kimi: { baseUrl: "https://api.moonshot.ai/v1", model: "moonshot-v1-8k", dialect: "openai" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", dialect: "openai" },
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-opus-4-8", dialect: "anthropic" },
  custom: { baseUrl: "", model: "", dialect: "openai" },
};

export function isAiProvider(v: string): v is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(v);
}

/** Resolve the effective base URL / model: explicit setting wins, else preset. */
export function resolveEndpoint(
  provider: AiProvider,
  baseUrl: string | null | undefined,
  model: string | null | undefined,
): { baseUrl: string; model: string; dialect: "openai" | "anthropic" } {
  const preset = AI_PRESETS[provider];
  return {
    baseUrl: (baseUrl?.trim() || preset.baseUrl).replace(/\/+$/, ""),
    model: model?.trim() || preset.model,
    dialect: preset.dialect,
  };
}

/** Parse the stored assistant-roles JSON. Unknown/invalid input → admin only. */
export function parseAssistantRoles(raw: string | null | undefined, allowed: readonly string[]): string[] {
  if (!raw) return ["ADMIN"];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return ["ADMIN"];
    const roles = arr.filter((r): r is string => typeof r === "string" && allowed.includes(r));
    // The admin can never lock themselves out of their own module.
    return roles.includes("ADMIN") ? roles : ["ADMIN", ...roles];
  } catch {
    return ["ADMIN"];
  }
}
