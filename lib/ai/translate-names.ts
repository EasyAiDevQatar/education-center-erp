import "server-only";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { aiChatJson } from "./client";
import { loadAiConfigFor, aiReady, type AiConfig } from "./config";

/**
 * AI-backed name transliteration (Arabic ↔ Latin) for people records.
 *
 * The register is Arabic-first (`name` required, `nameEn` optional — see
 * lib/names.ts). These helpers fill the missing `nameEn` so English screens
 * show Latin names. Every result stays editable, and a non-empty `nameEn` is
 * never overwritten.
 */

export type TranslatableEntity = "students" | "teachers" | "guardians";

const BATCH_SIZE = 25;

const SYSTEM_PROMPT =
  "You transliterate people's names for a tutoring-centre register in Qatar. " +
  "For each input name, produce the natural Latin-script (English) spelling. " +
  "If a name is already in Latin script, return it unchanged. Keep name order, " +
  "do not translate meanings (أمل is 'Amal', not 'Hope'). " +
  'Reply ONLY with a JSON object mapping each id to the Latin spelling, e.g. {"id1":"Mohammed Ali"}.';

/** Transliterate one batch. Returns id → Latin spelling (may be partial). */
export async function translateNamesBatch(
  rows: { id: string; name: string }[],
  config?: AiConfig,
): Promise<Record<string, string>> {
  if (rows.length === 0) return {};
  const result = await aiChatJson<Record<string, string>>(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(rows.map((r) => ({ id: r.id, name: r.name }))) },
    ],
    { maxTokens: 2048, config },
  );
  if (!result || typeof result !== "object") return {};
  const ids = new Set(rows.map((r) => r.id));
  const out: Record<string, string> = {};
  for (const [id, v] of Object.entries(result)) {
    if (ids.has(id) && typeof v === "string" && v.trim()) out[id] = v.trim().slice(0, 120);
  }
  return out;
}

const TABLES = {
  students: { model: "student", audit: "Student" },
  teachers: { model: "teacher", audit: "Teacher" },
  guardians: { model: "guardian", audit: "Guardian" },
} as const;

/**
 * Fill `nameEn` for every row of `entity` that has none. Batched; rows the
 * model skips are simply left empty for a later run. Returns counts.
 */
export async function backfillMissingNameEn(
  entity: TranslatableEntity,
): Promise<{ translated: number; remaining: number } | { error: string }> {
  const cfg = await loadAiConfigFor("translation");
  if (!aiReady(cfg)) return { error: "notConfigured" };

  const table = TABLES[entity];
  // Narrow, index-friendly query; identical shape across the three models.
  const delegate = db[table.model as "student"] as unknown as {
    findMany: (q: object) => Promise<{ id: string; name: string }[]>;
    update: (q: object) => Promise<unknown>;
    count: (q: object) => Promise<number>;
  };

  const rows = await delegate.findMany({
    where: { OR: [{ nameEn: null }, { nameEn: "" }] },
    select: { id: true, name: true },
    take: 500,
  });

  let translated = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const map = await translateNamesBatch(batch, cfg);
    for (const [id, nameEn] of Object.entries(map)) {
      await delegate.update({ where: { id }, data: { nameEn } });
      translated++;
    }
  }

  const remaining = await delegate.count({
    where: { OR: [{ nameEn: null }, { nameEn: "" }] },
  });
  await writeAudit(table.audit, "bulk-translate", "UPDATE", {
    after: { translated, remaining, by: "ai" },
  });
  return { translated, remaining };
}

/**
 * Best-effort auto-fill for a single freshly created record. Runs only when
 * the auto-translate toggle is on; short timeout; failures are swallowed —
 * saving the person must never block on the AI.
 */
export async function autoFillNameEn(
  entity: TranslatableEntity,
  id: string,
  name: string,
  existingNameEn: string | null | undefined,
): Promise<void> {
  if (existingNameEn?.trim()) return;
  try {
    const cfg = await loadAiConfigFor("translation");
    if (!aiReady(cfg) || !cfg.autoTranslateNames) return;
    const map = await translateNamesBatch([{ id, name }], cfg);
    const nameEn = map[id];
    if (!nameEn) return;
    const delegate = db[TABLES[entity].model as "student"] as unknown as {
      update: (q: object) => Promise<unknown>;
    };
    await delegate.update({ where: { id }, data: { nameEn } });
  } catch {
    // best-effort by design
  }
}
