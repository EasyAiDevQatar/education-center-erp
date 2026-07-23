import "server-only";
import { redirect } from "@/i18n/navigation";
import { requireRole, FINANCE_ROLES } from "@/lib/rbac";
import { accountingEnabled } from "./journal-data";
import type { SessionPayload } from "@/lib/session";

/**
 * Page guard for the accounting module: finance role AND the module flag.
 * Hiding the nav item is cosmetics; this is the enforcement.
 */
export async function requireAccounting(locale: string): Promise<SessionPayload> {
  const session = await requireRole(locale, FINANCE_ROLES);
  if (!(await accountingEnabled())) redirect({ href: "/dashboard", locale });
  return session;
}
