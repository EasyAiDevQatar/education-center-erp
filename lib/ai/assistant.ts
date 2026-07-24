import "server-only";
import { aiChat, type ChatMessage } from "./client";
import { loadAiConfigFor, type AiConfig } from "./config";
import { getTool, toolCatalog } from "./tools";

/**
 * The assistant loop: question -> (tool call ->)* -> answer.
 *
 * Provider-agnostic by construction — instead of native tool-use APIs (which
 * differ per provider), the model speaks a strict JSON protocol:
 *   {"tool": "<name>", "args": {...}}   to consult centre data
 *   {"answer": "<text>"}                to finish
 * Tools are the curated read-only set in lib/ai/tools.ts; the model never
 * sees the database and never mutates anything.
 */

export type AssistantTurn = { role: "user" | "assistant"; content: string };

const MAX_TOOL_ROUNDS = 6;

function systemPrompt(locale: string, todayIso: string): string {
  const lang = locale === "ar" ? "Arabic" : "English";
  return (
    "You are the management assistant of a private tutoring centre in Qatar " +
    "(students, teachers, sessions, payments, transport). Today is " +
    todayIso +
    ".\n\nYou can consult live centre data with these read-only tools:\n" +
    toolCatalog() +
    "\n\nProtocol — reply with ONLY one JSON object per turn, nothing else:\n" +
    '- To call a tool: {"tool": "<name>", "args": {...}}\n' +
    '- To answer the user: {"answer": "<your answer>"}\n' +
    "Call tools until you have the facts, then answer. Never invent numbers — " +
    "if a tool errors or data is missing, say so. Keep answers short and concrete. " +
    `Always write the final answer in ${lang}, whatever language the question was in. ` +
    "Tool results use English codes; translate them in your answer " +
    "(CENTER/HOME, COMPLETED/SCHEDULED/DRAFT/CHECKED_IN/NO_SHOW/CANCELLED, " +
    "UNPAID/PARTIAL/PAID). Amounts are in the centre\u2019s currency (QAR)."
  );
}

export type AssistantResult =
  | { ok: true; answer: string; toolsUsed: string[] }
  | { ok: false; error: string };

export async function runAssistant(
  question: string,
  history: AssistantTurn[],
  locale: string,
): Promise<AssistantResult> {
  // The assistant may run on its own model/key (see the AI Models settings);
  // load it once and reuse for every tool round.
  const config: AiConfig = await loadAiConfigFor("assistant");
  const today = new Date().toISOString().slice(0, 10);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(locale, today) },
    // Keep only the last few turns; each is small text.
    ...history.slice(-8).map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: question },
  ];

  const toolsUsed: string[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const r = await aiChat(messages, { maxTokens: 1500, timeoutMs: 45_000, config });
    if (!r.ok) return { ok: false, error: r.error };

    const parsed = parseTurn(r.text);
    if (!parsed) {
      // The model ignored the protocol; treat its text as the answer.
      return { ok: true, answer: r.text.trim(), toolsUsed };
    }
    if ("answer" in parsed) {
      return { ok: true, answer: parsed.answer, toolsUsed };
    }

    const tool = getTool(parsed.tool);
    messages.push({ role: "assistant", content: JSON.stringify(parsed) });
    if (!tool) {
      messages.push({ role: "user", content: `TOOL ERROR: unknown tool "${parsed.tool}". Use one of: ${toolCatalog()}` });
      continue;
    }
    toolsUsed.push(tool.name);
    let result: unknown;
    try {
      result = await tool.execute(parsed.args ?? {}, locale);
    } catch (e) {
      result = { error: e instanceof Error ? e.message : "tool failed" };
    }
    messages.push({
      role: "user",
      content: `TOOL RESULT (${tool.name}): ${JSON.stringify(result).slice(0, 6000)}`,
    });
  }

  return { ok: false, error: "tooManyRounds" };
}

function parseTurn(
  raw: string,
): { tool: string; args?: Record<string, unknown> } | { answer: string } | null {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]) as Record<string, unknown>;
    if (typeof obj.answer === "string") return { answer: obj.answer };
    if (typeof obj.tool === "string") {
      return { tool: obj.tool, args: (obj.args as Record<string, unknown>) ?? {} };
    }
    return null;
  } catch {
    return null;
  }
}
