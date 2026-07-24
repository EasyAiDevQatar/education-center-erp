"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { AI_PROVIDERS } from "@/lib/ai/presets";
import { loadAiConfig } from "@/lib/ai/config";
import { aiPing } from "@/lib/ai/client";

export type AiSettingsState = { ok?: boolean; error?: string; message?: string };

const STAFF = ["ADMIN", "ACCOUNTANT", "RECEPTIONIST"] as const;

const schema = z.object({
  enabled: z.boolean(),
  provider: z.enum(AI_PROVIDERS),
  baseUrl: z.string().trim().max(300),
  model: z.string().trim().max(120),
  apiKey: z.string().trim().max(500),
  autoTranslateNames: z.boolean(),
  assistantRoles: z.array(z.enum(STAFF)),
});

async function upsert(key: string, value: string) {
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function saveAiSettings(
  locale: string,
  _prev: AiSettingsState,
  formData: FormData,
): Promise<AiSettingsState> {
  const s = await getSession();
  if (!s || s.role !== "ADMIN") return { error: "forbidden" };

  const parsed = schema.safeParse({
    enabled: formData.get("aiEnabled") === "on",
    provider: formData.get("aiProvider") || "deepseek",
    baseUrl: formData.get("aiBaseUrl") ?? "",
    model: formData.get("aiModel") ?? "",
    apiKey: formData.get("aiApiKey") ?? "",
    autoTranslateNames: formData.get("aiAutoTranslateNames") === "on",
    assistantRoles: formData.getAll("aiAssistantRoles").map(String),
  });
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  await upsert("aiEnabled", d.enabled ? "1" : "0");
  await upsert("aiProvider", d.provider);
  await upsert("aiBaseUrl", d.baseUrl);
  await upsert("aiModel", d.model);
  // An empty key field means "keep the stored key" — the form shows a mask,
  // never the secret, so an untouched field must not wipe it.
  if (d.apiKey) await upsert("aiApiKey", d.apiKey);
  await upsert("aiAutoTranslateNames", d.autoTranslateNames ? "1" : "0");
  await upsert("aiAssistantRoles", JSON.stringify(d.assistantRoles));

  await writeAudit("Setting", "ai", "UPDATE", {
    after: { enabled: d.enabled, provider: d.provider, model: d.model, roles: d.assistantRoles, keyChanged: !!d.apiKey },
  });
  revalidatePath(`/${locale}/settings`);
  revalidatePath(`/${locale}`, "layout");
  return { ok: true };
}

/** One tiny round-trip against the configured provider. */
export async function testAiConnection(): Promise<AiSettingsState> {
  const s = await getSession();
  if (!s || s.role !== "ADMIN") return { error: "forbidden" };
  const cfg = await loadAiConfig();
  const r = await aiPing({ ...cfg, enabled: true });
  if (r.ok) return { ok: true, message: r.text.slice(0, 80) };
  return { error: r.error, message: r.detail?.slice(0, 200) };
}
