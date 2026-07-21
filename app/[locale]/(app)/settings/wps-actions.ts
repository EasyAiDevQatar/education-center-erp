"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { WPS_BANKS } from "@/lib/wps/banks";

export type WpsSettingsState = { ok?: boolean; error?: string };

const BANK_CODES = WPS_BANKS.map((b) => b.code) as [string, ...string[]];

/**
 * Loose at rest, strict at export: a half-filled card must be savable while
 * the centre is still collecting its numbers, so only formats are enforced
 * here. `validateSif` is what refuses to emit a file from incomplete settings.
 */
const schema = z.object({
  wpsEmployerEID: z.string().trim().regex(/^\d{7,8}$/).or(z.literal("")),
  wpsPayerEID: z.string().trim().regex(/^\d{7,8}$/).or(z.literal("")),
  wpsPayerQID: z.string().trim().regex(/^\d{11}$/).or(z.literal("")),
  wpsPayerBank: z.enum(BANK_CODES).or(z.literal("")),
  wpsPayerIBAN: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^QA\d{2}[A-Z0-9]{25}$/)
    .or(z.literal("")),
  wpsSifVersion: z.string().trim().max(35).default("1"),
});

export async function saveWpsSettings(
  locale: string,
  _prev: WpsSettingsState,
  formData: FormData,
): Promise<WpsSettingsState> {
  const s = await getSession();
  if (!s || s.role !== "ADMIN") return { error: "forbidden" };

  const parsed = schema.safeParse({
    wpsEmployerEID: (formData.get("wpsEmployerEID") ?? "").toString(),
    wpsPayerEID: (formData.get("wpsPayerEID") ?? "").toString(),
    wpsPayerQID: (formData.get("wpsPayerQID") ?? "").toString(),
    wpsPayerBank: (formData.get("wpsPayerBank") ?? "").toString(),
    wpsPayerIBAN: (formData.get("wpsPayerIBAN") ?? "").toString(),
    wpsSifVersion: (formData.get("wpsSifVersion") ?? "1").toString(),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { error: field ? `invalid_${String(field)}` : "invalid" };
  }

  for (const [key, value] of Object.entries(parsed.data)) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  await writeAudit("Setting", "wps", "UPDATE", { after: parsed.data });
  revalidatePath(`/${locale}/settings`);
  return { ok: true };
}
