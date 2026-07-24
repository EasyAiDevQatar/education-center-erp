"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import {
  backfillMissingNameEn,
  type TranslatableEntity,
} from "@/lib/ai/translate-names";

export type TranslateState = { translated?: number; remaining?: number; error?: string };

const ENTITIES: TranslatableEntity[] = ["students", "teachers", "guardians"];

/** Admin-only bulk fill of missing English name spellings via the AI module. */
export async function translateMissingNames(
  locale: string,
  entity: TranslatableEntity,
): Promise<TranslateState> {
  const s = await getSession();
  if (!s || s.role !== "ADMIN") return { error: "forbidden" };
  if (!ENTITIES.includes(entity)) return { error: "invalid" };

  const r = await backfillMissingNameEn(entity);
  if ("error" in r) return { error: r.error };
  revalidatePath(`/${locale}/${entity}`);
  return r;
}
