import "server-only";
import { db } from "@/lib/db";

/** Per-role, per-module access overrides. role → navKey → allowed. A missing
 *  entry means "use the default" (the module's own role list). ADMIN is never
 *  restricted. */
export type RolePerms = Record<string, Record<string, boolean>>;

/** Staff roles an admin may narrow. ADMIN always keeps everything; TEACHER,
 *  PARENT and DRIVER have fixed portals, not the staff menu. */
export const EDITABLE_ROLES = ["ACCOUNTANT", "RECEPTIONIST"] as const;

export async function loadRolePermissions(): Promise<RolePerms> {
  const row = await db.setting.findUnique({ where: { key: "rolePermissions" } });
  if (!row) return {};
  try {
    return JSON.parse(row.value) as RolePerms;
  } catch {
    return {};
  }
}

/** The map a single role's menu is filtered by (only `false` entries matter). */
export function permsForRole(all: RolePerms, role: string): Record<string, boolean> {
  return all[role] ?? {};
}
