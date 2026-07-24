import "server-only";
import { loadAiConfig, aiReady, type AiConfig } from "./config";

/**
 * Minimal chat client over the configured provider.
 *
 * Raw fetch, no SDKs: the module is provider-agnostic by design (the centre
 * picks DeepSeek/Kimi/OpenAI/Anthropic/custom later and pastes one key), and
 * every failure returns a typed result — an AI hiccup must never take a page
 * down with it.
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatResult =
  | { ok: true; text: string }
  | { ok: false; error: "notConfigured" | "http" | "network" | "empty"; detail?: string };

const DEFAULT_TIMEOUT_MS = 30_000;

export async function aiChat(
  messages: ChatMessage[],
  opts: { maxTokens?: number; timeoutMs?: number; config?: AiConfig } = {},
): Promise<ChatResult> {
  const cfg = opts.config ?? (await loadAiConfig());
  if (!aiReady(cfg)) return { ok: false, error: "notConfigured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    if (cfg.dialect === "anthropic") {
      // Anthropic Messages API: system is a top-level field, not a message.
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const rest = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: opts.maxTokens ?? 2048,
          ...(system ? { system } : {}),
          messages: rest,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        return { ok: false, error: "http", detail: `${res.status} ${(await res.text()).slice(0, 300)}` };
      }
      const data = (await res.json()) as {
        content?: { type: string; text?: string }[];
        stop_reason?: string;
      };
      if (data.stop_reason === "refusal") return { ok: false, error: "empty", detail: "refusal" };
      const text = (data.content ?? [])
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join("");
      return text ? { ok: true, text } : { ok: false, error: "empty" };
    }

    // OpenAI-compatible /chat/completions (DeepSeek, Kimi/Moonshot, OpenAI, custom).
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: opts.maxTokens ?? 2048,
        messages,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, error: "http", detail: `${res.status} ${(await res.text()).slice(0, 300)}` };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[];
    };
    const msg = data.choices?.[0]?.message;
    const text = msg?.content ?? "";
    if (text) return { ok: true, text };
    // Reasoning models can burn the whole budget thinking and return an empty
    // content field — surface that so callers can raise maxTokens.
    return {
      ok: false,
      error: "empty",
      detail: msg?.reasoning_content ? "reasoningOnly (raise maxTokens)" : data.choices?.[0]?.finish_reason,
    };
  } catch (e) {
    return { ok: false, error: "network", detail: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Chat expecting a JSON answer. The prompt must ask for JSON; this strips
 * markdown fences and parses, returning null on any failure.
 */
export async function aiChatJson<T>(
  messages: ChatMessage[],
  opts: { maxTokens?: number; timeoutMs?: number; config?: AiConfig } = {},
): Promise<T | null> {
  const r = await aiChat(messages, opts);
  if (!r.ok) return null;
  const raw = r.text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Models sometimes wrap JSON in prose; salvage the outermost object/array.
    const m = raw.match(/[[{][\s\S]*[\]}]/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as T;
    } catch {
      return null;
    }
  }
}

/** Cheap connectivity probe for the Settings "test connection" button. */
export async function aiPing(config?: AiConfig): Promise<ChatResult> {
  return aiChat([{ role: "user", content: "Reply with the single word: ok" }], {
    maxTokens: 16,
    timeoutMs: 15_000,
    config,
  });
}
