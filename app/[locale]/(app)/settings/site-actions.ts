"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";

export type SiteSettingsState = { ok?: boolean; error?: string };

const schema = z.object({
  publicHome: z.enum(["ERP", "CENTER", "LOGIN"]),
  siteHeroTitleAr: z.string().trim().max(120),
  siteHeroTitleEn: z.string().trim().max(120),
  siteHeroTextAr: z.string().trim().max(500),
  siteHeroTextEn: z.string().trim().max(500),
  siteAboutAr: z.string().trim().max(1000),
  siteAboutEn: z.string().trim().max(1000),
  siteYears: z.string().trim().max(10),
  siteStudents: z.string().trim().max(10),
  siteSuccessRate: z.string().trim().max(10),
  siteBranches: z.string().trim().max(10),
  siteWhatsApp: z.string().trim().regex(/^\+?\d{8,15}$/).or(z.literal("")),
});

export async function saveSiteSettings(
  locale: string,
  _prev: SiteSettingsState,
  formData: FormData,
): Promise<SiteSettingsState> {
  const s = await getSession();
  if (!s || s.role !== "ADMIN") return { error: "forbidden" };

  const parsed = schema.safeParse(
    Object.fromEntries(
      Object.keys(schema.shape).map((k) => [k, (formData.get(k) ?? "").toString()]),
    ),
  );
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { error: field ? `invalid_${String(field)}` : "invalid" };
  }

  for (const [key, value] of Object.entries(parsed.data)) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  await writeAudit("Setting", "site", "UPDATE", { after: { publicHome: parsed.data.publicHome } });
  revalidatePath(`/${locale}/settings`);
  // The public pages read these settings — refresh them too.
  revalidatePath(`/${locale}`);
  revalidatePath(`/${locale}/home`);
  revalidatePath(`/${locale}/erp`);
  return { ok: true };
}
