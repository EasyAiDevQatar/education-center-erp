import "server-only";
import { redirect } from "@/i18n/navigation";
import { requireRole, TRANSPORT_ROLES } from "@/lib/rbac";
import { transportEnabled } from "./settings";
import type { SessionPayload } from "@/lib/session";

/**
 * Page guard for the transport module: staff role AND the module flag.
 * Hiding the nav item is UX; this is the enforcement.
 */
export async function requireTransport(locale: string): Promise<SessionPayload> {
  const session = await requireRole(locale, TRANSPORT_ROLES);
  if (!(await transportEnabled())) redirect({ href: "/dashboard", locale });
  return session;
}
