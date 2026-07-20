"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { getProvider, loadConfig } from "@/lib/integrations/registry";
import { INTEGRATION_EVENTS, AUDIENCES } from "@/lib/integrations/types";

export type IntegrationState = { ok?: boolean; error?: string; message?: string };

async function guard() {
  const s = await getSession();
  return !s || s.role !== "ADMIN";
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
  if (await guard()) return { error: "forbidden" };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;
  if (!getProvider(d.provider)) return { error: "unknownProvider" };

  const existing = await db.integration.findUnique({ where: { provider: d.provider } });
  // Blank apiKey on an existing record = keep what's stored.
  const apiKey = d.apiKey && d.apiKey.length > 0 ? d.apiKey : existing?.apiKey ?? null;

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

/** Verify credentials against the provider without sending a real message. */
export async function testIntegration(
  locale: string,
  provider: string,
): Promise<IntegrationState> {
  if (await guard()) return { error: "forbidden" };
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
  if (await guard()) return { error: "forbidden" };
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
