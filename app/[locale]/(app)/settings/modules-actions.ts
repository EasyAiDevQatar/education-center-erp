"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { OPTIONAL_MODULE_SETTING, OPTIONAL_MODULES, type OptionalModule } from "@/lib/modules";

export type ModulesState = { ok?: boolean; error?: string };

async function guard() {
  const s = await getSession();
  // Which modules the centre runs is an owner-level decision.
  return !s || s.role !== "ADMIN";
}

/**
 * Switch the on-by-default modules on or off.
 *
 * Writes "1"/"0" explicitly rather than deleting the row to mean on: an absent
 * row also reads as on, but a stored value records that somebody decided, which
 * is what the audit trail is for.
 */
export async function saveOptionalModules(
  locale: string,
  next: Partial<Record<OptionalModule, boolean>>,
): Promise<ModulesState> {
  if (await guard()) return { error: "forbidden" };

  const after: Record<string, string> = {};
  for (const m of OPTIONAL_MODULES) {
    const key = OPTIONAL_MODULE_SETTING[m];
    const value = next[m] !== false ? "1" : "0";
    after[key] = value;
    await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  await writeAudit("Setting", "optionalModules", "UPDATE", { after });

  // The shell renders the nav from these flags, so the whole layout has to be
  // rebuilt — revalidating only /settings would leave the old menu in place.
  revalidatePath(`/${locale}`, "layout");
  return { ok: true };
}
