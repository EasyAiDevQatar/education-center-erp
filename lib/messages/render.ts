/**
 * Message templates: what a centre may write, and what it may put in it.
 *
 * The wording used to be nine hard-coded strings in notify.ts, so changing
 * "تم حجز حصة" to whatever this centre actually says meant a deploy. These are
 * the pure halves of the replacement — no database, no server-only — so the
 * substitution rules and the variable catalogue can be tested directly.
 */

/** `{{ name }}` — spaces tolerated, because people type them. */
const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export type TemplateVars = Record<string, string | number | null | undefined>;

/**
 * Substitute variables into a template.
 *
 * An unknown or empty variable renders as an empty string rather than leaving
 * `{{invoice}}` in the message. A parent should never receive punctuation the
 * centre did not write — and a template that names a variable the event does
 * not carry is a mistake to catch in the editor, not in somebody's WhatsApp.
 */
export function renderTemplate(body: string, vars: TemplateVars): string {
  return body
    .replace(TOKEN, (_m, key: string) => {
      const value = vars[key];
      return value === null || value === undefined ? "" : String(value);
    })
    // Substituting an empty value can leave doubled spaces or a space before
    // a full stop; tidy those rather than sending them.
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,؛،!؟])/g, "$1")
    .trim();
}

/** Every variable a template names, in order of first appearance. */
export function variablesUsed(body: string): string[] {
  return [...new Set([...body.matchAll(TOKEN)].map((m) => m[1]))];
}

/**
 * The variables each event actually carries.
 *
 * This is the contract between notify.ts and the template editor: the editor
 * offers exactly these, and `unknownVariables` refuses anything else on save.
 * Without it a centre can write {{invoice}} into a booking message, see it
 * render as nothing, and have no way to find out why.
 */
export const COMMON_VARIABLES = ["center", "currency", "date", "time"] as const;

export const EVENT_VARIABLES: Record<string, readonly string[]> = {
  SESSION_BOOKED: ["student", "guardian", "teacher", "hours", "location", "price"],
  SESSION_RESCHEDULED: ["student", "guardian", "teacher", "hours", "location"],
  SESSION_CANCELLED: ["student", "guardian", "teacher"],
  CHECKED_IN: ["student", "guardian", "teacher"],
  CHECKED_OUT: ["student", "guardian", "teacher", "hours"],
  SESSION_NO_SHOW: ["student", "guardian", "teacher"],
  PAYMENT_RECEIVED: ["student", "guardian", "amount", "invoice", "method", "balance"],
  PAYOUT_PAID: ["teacher", "amount", "period"],
  BALANCE_REMINDER: ["student", "guardian", "amount"],
  SESSION_REMINDER: ["student", "guardian", "teacher", "hours", "location"],
  PACKAGE_LOW: ["student", "guardian", "hours"],
};

/** Everything a given event's template may name. */
export function allowedVariables(event: string): string[] {
  return [...COMMON_VARIABLES, ...(EVENT_VARIABLES[event] ?? [])];
}

/** Variables a template names that its event does not carry. Empty is good. */
export function unknownVariables(event: string, body: string): string[] {
  const allowed = new Set(allowedVariables(event));
  return variablesUsed(body).filter((v) => !allowed.has(v));
}
