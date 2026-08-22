"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { INTEGRATION_EVENTS, AUDIENCES } from "@/lib/integrations/types";
import { unknownVariables, renderTemplate, allowedVariables } from "@/lib/messages/render";

export type TemplateState = { ok?: boolean; error?: string; detail?: string };

/**
 * Editing the centre's own wording is staff work, not administrator work — the
 * receptionist who answers the phone knows better than anybody what the message
 * should say. The credential that sends it is a separate question, and stays
 * behind its own lock.
 */
async function guard() {
  const s = await getSession();
  if (!s || !(STAFF_ROLES as readonly string[]).includes(s.role)) return { error: "forbidden" };
  return null;
}

const saveSchema = z.object({
  event: z.enum(INTEGRATION_EVENTS),
  /** Empty string means "everyone who gets this event". */
  audience: z.union([z.enum(AUDIENCES), z.literal("")]),
  locale: z.enum(["ar", "en"]),
  body: z.string().trim().max(1500),
});

export async function saveTemplate(
  locale: string,
  input: z.infer<typeof saveSchema>,
): Promise<TemplateState> {
  const denied = await guard();
  if (denied) return denied;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;
  const audience = d.audience === "" ? null : d.audience;

  const existing = await db.messageTemplate.findFirst({
    where: { event: d.event, audience, locale: d.locale },
    select: { id: true },
  });

  // An empty body is how a centre says "go back to the built-in wording".
  if (!d.body) {
    if (existing) await db.messageTemplate.delete({ where: { id: existing.id } });
    await writeAudit("MessageTemplate", `${d.event}:${audience ?? "*"}:${d.locale}`, "DELETE");
    revalidatePath(`/${locale}/messages`);
    return { ok: true };
  }

  // Refused rather than saved-and-blank: a template naming a variable the
  // event does not carry renders as nothing, and the centre would have no way
  // to tell that from a template that simply does not work.
  const unknown = unknownVariables(d.event, d.body);
  if (unknown.length) return { error: "unknownVariable", detail: unknown.join(", ") };

  if (existing) {
    await db.messageTemplate.update({
      where: { id: existing.id },
      data: { body: d.body, active: true },
    });
  } else {
    await db.messageTemplate.create({
      data: { event: d.event, audience, locale: d.locale, body: d.body, active: true },
    });
  }
  await writeAudit("MessageTemplate", `${d.event}:${audience ?? "*"}:${d.locale}`, "UPDATE", {
    after: { body: d.body },
  });
  revalidatePath(`/${locale}/messages`);
  return { ok: true };
}

/**
 * What this template would look like sent, with the variables filled in by
 * example values. Cheaper than discovering a stray {{ }} in a parent's chat.
 */
export async function previewTemplate(
  event: string,
  body: string,
): Promise<TemplateState & { text?: string }> {
  const denied = await guard();
  if (denied) return denied;

  const unknown = unknownVariables(event, body);
  if (unknown.length) return { error: "unknownVariable", detail: unknown.join(", ") };

  const settings = await db.setting.findMany({
    where: { key: { in: ["centerName", "currency"] } },
  });
  const map = Object.fromEntries(settings.map((r) => [r.key, r.value]));

  const samples: Record<string, string> = {
    center: map.centerName ?? "المركز",
    currency: map.currency ?? "QAR",
    date: "2026-08-22",
    time: "16:00",
    student: "خالد العطية",
    guardian: "أبو خالد العطية",
    teacher: "رحاب السويدي",
    hours: "2",
    amount: "250.00",
    invoice: "1042",
    method: "CASH",
    balance: "875.00",
    location: "المركز",
    price: "250.00",
    period: "2026-08",
  };
  const vars = Object.fromEntries(allowedVariables(event).map((v) => [v, samples[v] ?? v]));
  return { ok: true, text: renderTemplate(body, vars) };
}
