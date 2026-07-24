import "server-only";
import { db } from "@/lib/db";
import type { Role } from "@/lib/enums";

/** Per-role, per-module menu overrides. role → navKey → allowed. Missing = use
 *  the module's own role list. */
export type RolePerms = Record<string, Record<string, boolean>>;

/** Staff roles an admin may narrow in the matrix. */
export const EDITABLE_ROLES = ["ACCOUNTANT", "RECEPTIONIST"] as const;

/** The fixed built-in roles (the capability set the route guards understand). */
export const BUILTIN_ROLES = [
  "ADMIN",
  "ACCOUNTANT",
  "RECEPTIONIST",
  "TEACHER",
  "PARENT",
  "DRIVER",
] as const;

export type CustomRoleRow = {
  id: string;
  key: string;
  name: string;
  nameEn: string | null;
  baseRole: string;
  permissions: Record<string, boolean>;
};

function safeParse(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export async function loadRolePermissions(): Promise<RolePerms> {
  const row = await db.setting.findUnique({ where: { key: "rolePermissions" } });
  if (!row) return {};
  try {
    return JSON.parse(row.value) as RolePerms;
  } catch {
    return {};
  }
}

export async function loadCustomRoles(): Promise<CustomRoleRow[]> {
  const rows = await db.customRole.findMany({ orderBy: { name: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    nameEn: r.nameEn,
    baseRole: r.baseRole,
    permissions: safeParse(r.permissions),
  }));
}

const isBuiltin = (key: string) => (BUILTIN_ROLES as readonly string[]).includes(key);

/**
 * The route-guard capability of a role identifier. Built-in roles are their own
 * capability; a custom role borrows its `baseRole`. This is what the session's
 * `role` is set to, so every existing `requireRole([...])` keeps working.
 */
export function capabilityOf(key: string, custom: CustomRoleRow[]): Role {
  if (isBuiltin(key)) return key as Role;
  const c = custom.find((x) => x.key === key);
  return (c?.baseRole ?? "RECEPTIONIST") as Role;
}

/** The module-visibility map for the currently active role. */
export function activePerms(
  activeKey: string,
  rolePerms: RolePerms,
  custom: CustomRoleRow[],
): Record<string, boolean> {
  if (isBuiltin(activeKey)) return rolePerms[activeKey] ?? {};
  return custom.find((x) => x.key === activeKey)?.permissions ?? {};
}

/** The full set of role identifiers a user may act as (primary always included). */
export function parseRoleKeys(raw: string | null | undefined, primary: string): string[] {
  if (!raw) return [primary];
  try {
    const a = JSON.parse(raw);
    if (Array.isArray(a) && a.length) {
      return [...new Set([primary, ...a.map(String)])];
    }
  } catch {
    // fall through
  }
  return [primary];
}

/** Display label for a role identifier: custom name or the i18n built-in key. */
export function roleLabel(
  key: string,
  locale: string,
  custom: CustomRoleRow[],
  builtinLabel: (k: string) => string,
): string {
  if (isBuiltin(key)) return builtinLabel(key);
  const c = custom.find((x) => x.key === key);
  if (!c) return key;
  return locale === "en" ? c.nameEn?.trim() || c.name : c.name;
}

export function permsForRole(all: RolePerms, role: string): Record<string, boolean> {
  return all[role] ?? {};
}
