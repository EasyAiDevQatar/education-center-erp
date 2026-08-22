"use server";

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { getProvider, loadConfig } from "@/lib/integrations/registry";
import { encryptSecret } from "@/lib/integrations/secret-crypto";
import { requireGate } from "@/lib/integrations/gate";
import { INTEGRATION_EVENTS, AUDIENCES } from "@/lib/integrations/types";

export type IntegrationState = { ok?: boolean; error?: string; message?: string };

/**
 * ADMIN, and through the module's own password.
 *
 * Returns the error rather than a boolean because "locked" and "forbidden" are
 * different answers and the form needs to tell them apart. Every exported
 * action calls this — a gate the page checks but the actions do not is not a
 * gate, because an action is reachable without ever loading the page.
 */
async function guard(): Promise<{ error: string } | null> {
  const s = await getSession();
  if (!s || s.role !== "ADMIN") return { error: "forbidden" };
  return requireGate();
}

const saveSchema = z.object({
  provider: z.string().min(1),
  enabled: z.boolean(),
  baseUrl: z.string().trim().max(500).optional().nullable(),
  /** Empty string means "keep the stored key" so the UI never has to echo it. */
  apiKey: z.string().trim().max(500).optional().nullable(),
  config: z.record(z.string(), z.string()).default({}),
  events: z.array(z.enum(INTEGRATION_EVENTS)).default([]),
  audiences: z.array(z.enum(AUDIENCES)).default([]),
});

export async function saveIntegration(
  locale: string,
  input: z.infer<typeof saveSchema>,
): Promise<IntegrationState> {
  const denied = await guard();
  if (denied) return denied;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;
  if (!getProvider(d.provider)) return { error: "unknownProvider" };

  const existing = await db.integration.findUnique({ where: { provider: d.provider } });
  // Blank apiKey on an existing record = keep what's stored, already encrypted.
  // A new key is encrypted here; the clear text never reaches the database, the
  // audit trail, or a backup file.
  const apiKey =
    d.apiKey && d.apiKey.length > 0 ? encryptSecret(d.apiKey) : existing?.apiKey ?? null;

  const data = {
    enabled: d.enabled,
    baseUrl: d.baseUrl || null,
    apiKey,
    config: JSON.stringify(d.config ?? {}),
    events: JSON.stringify(d.events ?? []),
    audiences: JSON.stringify(d.audiences ?? []),
  };

  await db.integration.upsert({
    where: { provider: d.provider },
    create: { provider: d.provider, ...data },
    update: data,
  });

  // Never write the secret into the audit trail.
  await writeAudit("Integration", d.provider, existing ? "UPDATE" : "CREATE", {
    after: { ...data, apiKey: apiKey ? "***" : null },
  });
  revalidatePath(`/${locale}/settings`);
  return { ok: true };
}

/**
 * Issue or replace the inbound webhook secret.
 *
 * The secret IS the credential on the callback URL, so rotating it is how a
 * URL that has leaked — pasted into a chat, left in a screenshot — is revoked.
 * Rotating breaks inbound until the new URL is saved at the provider, which is
 * why the screen says so rather than doing it quietly.
 */
export async function rotateWebhookSecret(
  locale: string,
  provider: string,
): Promise<IntegrationState> {
  const denied = await guard();
  if (denied) return denied;
  if (!getProvider(provider)) return { error: "unknownProvider" };

  // 32 bytes of URL-safe randomness: long enough that guessing is not a
  // strategy, short enough to paste into the provider's settings box.
  const secret = randomBytes(24).toString("base64url");
  await db.integration.upsert({
    where: { provider },
    create: { provider, webhookSecret: secret },
    update: { webhookSecret: secret },
  });
  // The secret itself never enters the audit trail.
  await writeAudit("Integration", provider, "UPDATE", { after: { webhookSecret: "rotated" } });
  revalidatePath(`/${locale}/settings`);
  return { ok: true };
}

/** Verify credentials against the provider without sending a real message. */
export async function testIntegration(
  locale: string,
  provider: string,
): Promise<IntegrationState> {
  const denied = await guard();
  if (denied) return denied;
  const impl = getProvider(provider);
  if (!impl) return { error: "unknownProvider" };
  const cfg = await loadConfig(provider);
  if (!cfg) return { error: "notConfigured" };

  const res = await impl.testConnection(cfg);
  await db.integration.update({
    where: { provider },
    data: {
      lastTestAt: new Date(),
      lastTestOk: res.ok,
      lastTestMsg: (res.ok ? res.message : [res.error, res.message].filter(Boolean).join(" — "))?.slice(0, 500) ?? null,
    },
  });
  revalidatePath(`/${locale}/settings`);
  return res.ok
    ? { ok: true, message: res.message }
    : { error: res.error ?? "failed", message: res.message };
}

/** Send a test message to a phone number to validate end-to-end delivery. */
export async function sendTestMessage(
  locale: string,
  provider: string,
  to: string,
): Promise<IntegrationState> {
  const denied = await guard();
  if (denied) return denied;
  const impl = getProvider(provider);
  if (!impl) return { error: "unknownProvider" };
  const cfg = await loadConfig(provider);
  if (!cfg) return { error: "notConfigured" };
  if (!to.trim()) return { error: "noRecipient" };

  const text = "Education Center ERP — test message / رسالة تجريبية";
  const res = await impl.send(cfg, { to: to.trim(), text });

  await db.notificationLog.create({
    data: {
      provider,
      event: "TEST",
      audience: "TEACHER",
      recipient: to.trim(),
      status: res.ok ? "SENT" : "FAILED",
      message: text,
      error: res.ok ? null : [res.error, res.message].filter(Boolean).join(" — ").slice(0, 500),
    },
  });
  revalidatePath(`/${locale}/settings`);
  return res.ok ? { ok: true, message: res.message } : { error: res.error ?? "failed", message: res.message };
}
