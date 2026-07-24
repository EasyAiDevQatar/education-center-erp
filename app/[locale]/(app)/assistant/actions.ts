"use server";

import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { loadAiConfigFor, aiReady } from "@/lib/ai/config";
import { runAssistant, type AssistantTurn } from "@/lib/ai/assistant";

export type AskState =
  | { ok: true; answer: string; toolsUsed: string[] }
  | { ok: false; error: string };

/**
 * One assistant round-trip. Access is enforced here (flag + role list from
 * Settings), and every question is written to the audit log so management can
 * see who asked what.
 */
export async function askAssistant(
  locale: string,
  question: string,
  history: AssistantTurn[],
): Promise<AskState> {
  const s = await getSession();
  if (!s) return { ok: false, error: "forbidden" };
  // Enabled + role come from the module default; readiness reflects the
  // assistant's own model/key when it overrides the default.
  const cfg = await loadAiConfigFor("assistant");
  if (!cfg.enabled || !cfg.assistantRoles.includes(s.role)) {
    return { ok: false, error: "forbidden" };
  }
  if (!aiReady(cfg)) return { ok: false, error: "notConfigured" };

  const q = question.trim().slice(0, 2000);
  if (!q) return { ok: false, error: "empty" };

  await writeAudit("AiAssistant", s.userId ?? "unknown", "CREATE", {
    after: { question: q },
  });

  const safeHistory = Array.isArray(history)
    ? history
        .filter(
          (h): h is AssistantTurn =>
            !!h &&
            (h.role === "user" || h.role === "assistant") &&
            typeof h.content === "string",
        )
        .map((h) => ({ role: h.role, content: h.content.slice(0, 4000) }))
    : [];

  return runAssistant(q, safeHistory, locale);
}
