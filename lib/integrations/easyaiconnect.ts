import type { Provider, IntegrationConfig, SendInput, ProviderResult } from "./types";

/**
 * EasyAiConnect (Anychat.one) messaging provider.
 *
 * The exact REST contract is configurable from Settings → Integrations, because
 * the endpoint paths and payload field names differ between Anychat deployments.
 * The defaults below are a sensible starting point — adjust them to match your
 * account's API docs without touching code.
 */

const DEFAULTS = {
  sendPath: "/api/v1/messages",
  testPath: "/api/v1/me",
  authScheme: "Bearer",
  toField: "to",
  textField: "message",
};

function cfgVal(cfg: IntegrationConfig, key: keyof typeof DEFAULTS): string {
  const v = cfg.config?.[key];
  return v && v.trim() ? v.trim() : DEFAULTS[key];
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function request(
  cfg: IntegrationConfig,
  path: string,
  init: RequestInit,
): Promise<ProviderResult> {
  if (!cfg.baseUrl) return { ok: false, error: "missingBaseUrl" };
  if (!cfg.apiKey) return { ok: false, error: "missingApiKey" };

  const scheme = cfgVal(cfg, "authScheme");
  const url = joinUrl(cfg.baseUrl, path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: scheme ? `${scheme} ${cfg.apiKey}` : cfg.apiKey,
        ...(init.headers ?? {}),
      },
    });
    const body = await res.text();
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, message: body.slice(0, 300) };
    }
    return { ok: true, message: body.slice(0, 300) || `HTTP ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg === "The operation was aborted." ? "timeout" : msg };
  } finally {
    clearTimeout(timeout);
  }
}

export const easyAiConnect: Provider = {
  key: "EASYAICONNECT",
  label: "EasyAiConnect (Anychat.one)",
  docsUrl: "https://anychat.one",
  fields: [
    { key: "sendPath", labelKey: "sendPath", type: "text", placeholder: DEFAULTS.sendPath, help: "endpointHelp" },
    { key: "testPath", labelKey: "testPath", type: "text", placeholder: DEFAULTS.testPath },
    { key: "authScheme", labelKey: "authScheme", type: "text", placeholder: DEFAULTS.authScheme },
    { key: "toField", labelKey: "toField", type: "text", placeholder: DEFAULTS.toField },
    { key: "textField", labelKey: "textField", type: "text", placeholder: DEFAULTS.textField },
  ],

  async testConnection(cfg) {
    return request(cfg, cfgVal(cfg, "testPath"), { method: "GET" });
  },

  async send(cfg, input: SendInput) {
    const body: Record<string, string> = {
      [cfgVal(cfg, "toField")]: input.to,
      [cfgVal(cfg, "textField")]: input.text,
    };
    return request(cfg, cfgVal(cfg, "sendPath"), {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
};
