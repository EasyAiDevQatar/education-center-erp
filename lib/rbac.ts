import "server-only";
import { getSession, type SessionPayload } from "./session";
import { redirect } from "@/i18n/navigation";
import type { Role } from "./enums";

/**
 * Capability sets.
 *
 * These are the whole access-control surface: every page guard names one of
 * them, so widening a role is a change here rather than an audit of thirty
 * files. They are deliberately narrower than "staff" — a transport coordinator
 * and a cashier are both staff, and neither should see what the other does.
 *
 * The rule when adding a role: give it the smallest set that lets it do its job,
 * and never fold two jobs into one set because the pages happen to sit near each
 * other in the menu.
 */

/** The centre's own books: profit, expenses, financial reports. */
export const FINANCE_ROLES: Role[] = ["ADMIN", "ACCOUNTANT"];

/** Employee identity documents (QID, passport, IBAN), leave, HR records.
    Deliberately excludes the accountant: they need salary figures, not
    passport numbers. */
export const HR_ROLES: Role[] = ["ADMIN", "HR_OFFICER"];

/** The general front desk. The base every wider staff set is built from. */
export const STAFF_ROLES: Role[] = ["ADMIN", "ACCOUNTANT", "RECEPTIONIST"];

/** Teaching operations: timetable, planner, attendance, groups, leads. */
export const ACADEMIC_ROLES: Role[] = [...STAFF_ROLES, "ACADEMIC_SUPERVISOR"];

/** People records: students, guardians, teachers. A cashier needs the family
    to bill it; a supervisor needs the pupil to timetable them. */
export const PEOPLE_ROLES: Role[] = [
  ...STAFF_ROLES,
  "ACADEMIC_SUPERVISOR",
  "CASHIER",
];

/** Money coming IN: payments, receipts, packages, what a family owes. */
export const BILLING_ROLES: Role[] = [...STAFF_ROLES, "CASHIER"];

/** Money going OUT to staff: payouts, payroll runs, WPS. Separate from
    FINANCE_ROLES because paying the staff is not the same job as owning the
    centre's P&L. */
export const PAYROLL_ROLES: Role[] = ["ADMIN", "ACCOUNTANT", "HR_OFFICER"];

/** The fleet: planner, trips, drivers, vehicles, running costs. */
export const TRANSPORT_ROLES: Role[] = [...STAFF_ROLES, "TRANSPORT_COORDINATOR"];

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
