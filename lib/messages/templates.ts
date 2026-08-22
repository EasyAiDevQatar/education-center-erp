import "server-only";
import { db } from "@/lib/db";
import { renderTemplate, type TemplateVars } from "./render";

/**
 * The centre's own wording, where it has any.
 *
 * A stored template overrides the built-in for one event, audience and
 * language. Nothing stored means the built-in text, which is why a centre can
 * experiment with wording and get back to something sane by deleting a row
 * rather than by restoring a backup.
 *
 * Resolution order, most specific first:
 *   1. this event + this audience + this language
 *   2. this event + any audience + this language
 *   3. the built-in string compiled into notify.ts
 */

export type StoredTemplate = {
  event: string;
  audience: string | null;
  locale: string;
  body: string;
  active: boolean;
};

/** Every active template for one event — one query per dispatch, not per recipient. */
export async function templatesFor(event: string): Promise<StoredTemplate[]> {
  return db.messageTemplate.findMany({
    where: { event, active: true },
    select: { event: true, audience: true, locale: true, body: true, active: true },
  });
}

/**
 * Pick the body for one recipient and render it.
 *
 * `builtIn` is already-rendered text rather than a template, because the
 * built-ins are functions of the same variables and there is no point turning
 * them into strings only to substitute them back.
 */
export function bodyFor(
  templates: StoredTemplate[],
  audience: string,
  locale: string,
  vars: TemplateVars,
  builtIn: string,
): string {
  const exact = templates.find((t) => t.audience === audience && t.locale === locale);
  const general = templates.find((t) => t.audience === null && t.locale === locale);
  const chosen = exact ?? general;
  if (!chosen) return builtIn;
  const rendered = renderTemplate(chosen.body, vars);
  // A template edited down to nothing would otherwise send a blank WhatsApp.
  return rendered || builtIn;
}
