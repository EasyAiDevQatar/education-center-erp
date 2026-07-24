import "server-only";
import { db } from "@/lib/db";
import { STAFF_ROLES } from "@/lib/rbac";
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
