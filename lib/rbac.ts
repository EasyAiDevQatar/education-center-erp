import "server-only";
import { getSession, type SessionPayload } from "./session";
import { redirect } from "@/i18n/navigation";
import type { Role } from "./enums";

/** Roles that can see all financial data and admin areas. */
export const FINANCE_ROLES: Role[] = ["ADMIN", "ACCOUNTANT"];
/** Roles that can read employee identity documents (QID, passport, IBAN).
    Deliberately narrower than FINANCE_ROLES: an accountant needs salary
    figures, not passport numbers. */
export const HR_ROLES: Role[] = ["ADMIN"];
/** Roles that can operate the front desk (sessions, students, payments). */
export const STAFF_ROLES: Role[] = ["ADMIN", "ACCOUNTANT", "RECEPTIONIST"];

/** Require an authenticated session or redirect to the login page. */
export async function requireAuth(locale: string): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect({ href: "/login", locale });
  return session!;
}

/** Require the session to hold one of the allowed roles, else send home. */
export async function requireRole(
  locale: string,
  allowed: Role[],
): Promise<SessionPayload> {
  const session = await requireAuth(locale);
  // The root is public now; an authorised-but-wrong-role user belongs on
  // their dashboard (which itself routes teachers/parents to their portals).
  if (!allowed.includes(session.role)) redirect({ href: "/dashboard", locale });
  return session;
}

export function hasRole(session: SessionPayload | null, allowed: Role[]): boolean {
  return !!session && allowed.includes(session.role);
}
