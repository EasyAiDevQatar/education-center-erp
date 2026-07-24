import "server-only";
import { redirect } from "@/i18n/navigation";
import { getSession } from "@/lib/session";
import { loadAiConfig } from "./config";

/**
 * Gate for AI-module pages (the assistant).
 *
 * Enforced in the query layer, not just the nav: the module must be enabled
 * AND the user's role ticked in the Settings role list (which always includes
 * ADMIN — see parseAssistantRoles).
 */
export async function requireAi(locale: string) {
  const s = await getSession();
  if (!s) redirect({ href: "/login", locale });
  const cfg = await loadAiConfig();
  if (!cfg.enabled || !cfg.assistantRoles.includes(s!.role)) {
    redirect({ href: "/dashboard", locale });
  }
  return { session: s!, config: cfg };
}
