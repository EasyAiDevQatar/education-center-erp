import type { Provider, IntegrationConfig, SendInput, ProviderResult } from "./types";
import { normalizePhone } from "./phone";

/**
 * EasyAiConnect — the centre's WhatsApp channel.
 *
 * This file previously described its own endpoints as configurable "because
 * the paths differ between deployments". They do not differ; they were
 * guessed. The defaults were wrong in every particular — the auth header, both
 * paths and all three body fields — so no message this integration ever tried
 * to send could have arrived, and every screen and log built on top of it was
 * reporting on a delivery path that did not exist.
 *
 * What is below is the contract in production use, taken from a working
 * deployment rather than inferred. It is deliberately NOT configurable: a
 * wrong default made editable is still a wrong default, and it hands the
 * centre a way to break delivery by typing in a settings box. The one thing
 * that genuinely varies per account — the channel — is the one field kept.
 */

/**
 * The upstream host. This is the only place in the codebase the delivery
 * vendor is named, and `tests/unit/easyaiconnect-whitelabel.test.ts` fails if
 * that stops being true. It is not configurable, not rendered, not returned in
 * an error, and not written to the notification log — the product is
 * EasyAiConnect everywhere a person can see.
 *
 * This hides the vendor from users of the app, not from anyone who can read
 * outbound traffic on the server. Hiding it there would need a branded
 * endpoint, which does not exist today.
 */
const UPSTREAM = "https://api.anychat.one";

const SEND_PATH = "/public/v1/chat";
const TEST_PATH = "/public/v1/workspace";
const CHAT_PATH = "/public/v1/chat/";
const CONTACT_PATH = "/public/v1/contact/";
const TIMEOUT_MS = 20_000;

/** The channel is a GUID; anything else is a paste error worth catching early. */
const CHANNEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function channelOf(cfg: IntegrationConfig): string | null {
  const value = (cfg.config?.channelId ?? "").trim();
  return CHANNEL_ID.test(value) ? value : null;
}

/**
 * Our own error codes, never the upstream's words.
 *
 * A provider's message can carry its own hostname, product name and account
 * identifiers. Passing it through to a toast is how a white label leaks, so
 * responses become a code the UI translates and nothing else.
 */
function codeFor(status: number): string {
  if (status === 401 || status === 403) return "badCredentials";
  if (status === 404) return "badChannel";
  if (status === 422 || status === 400) return "badRequest";
  if (status === 429) return "rateLimited";
  if (status >= 500) return "providerDown";
  return `http_${status}`;
}

async function request(
  cfg: IntegrationConfig,
  path: string,
  init: RequestInit = {},
): Promise<ProviderResult> {
  if (!cfg.apiKey) return { ok: false, error: "missingApiKey" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${UPSTREAM}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        // Not Bearer. The previous code sent an Authorization header the
        // provider ignores, so every call was unauthenticated.
        "x-api-key": cfg.apiKey,
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) return { ok: false, error: codeFor(res.status) };
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: /abort/i.test(msg) ? "timeout" : "networkError" };
  } finally {
    clearTimeout(timer);
  }
}

/** Same call, but the parsed body — only the inbound lookup needs it. */
async function getJson(cfg: IntegrationConfig, path: string): Promise<unknown | null> {
  if (!cfg.apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${UPSTREAM}${path}`, {
      signal: controller.signal,
      headers: { Accept: "application/json", "x-api-key": cfg.apiKey },
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const easyAiConnect: Provider = {
  key: "EASYAICONNECT",
  label: "EasyAiConnect",
  fields: [
    { key: "channelId", labelKey: "channelId", type: "text", required: true, help: "channelIdHelp" },
  ],

  async testConnection(cfg) {
    // Reaching the workspace proves the key without messaging anybody.
    const res = await request(cfg, TEST_PATH, { method: "GET" });
    if (!res.ok) return res;
    // A key that works but a channel that does not is still not ready to send,
    // and the centre should learn that here rather than from a silent failure
    // the first time a parent was supposed to be told about a cancellation.
    return channelOf(cfg) ? res : { ok: false, error: "badChannel" };
  },

  async send(cfg, input: SendInput) {
    const channel = channelOf(cfg);
    if (!channel) return { ok: false, error: "badChannel" };
    const phone = normalizePhone(input.to);
    if (!phone) return { ok: false, error: "badRecipient" };

    return request(cfg, SEND_PATH, {
      method: "POST",
      body: JSON.stringify({ channel, phone, message: input.text }),
    });
  },

  /**
   * A conversation carries a contact handle, not a phone number, so this is two
   * hops: the chat names a contact, the contact has the number. Both are
   * best-effort — a message from somebody the centre has never met is still
   * worth recording, just unmatched.
   */
  async lookupContact(cfg, threadId) {
    const chat = (await getJson(cfg, CHAT_PATH + encodeURIComponent(threadId))) as
      | { contact?: string | { guid?: string } }
      | null;
    const raw = chat?.contact;
    const contactGuid = typeof raw === "string" ? raw : raw?.guid;
    if (!contactGuid) return { phone: null, name: null };

    const contact = (await getJson(cfg, CONTACT_PATH + encodeURIComponent(contactGuid))) as
      | { clean_phone?: string; phone?: string; name?: string }
      | null;
    return {
      phone: contact?.clean_phone ?? contact?.phone ?? null,
      name: (contact?.name ?? "").trim() || null,
    };
  },
};
