"use server";

import { revalidatePath } from "next/cache";
import { getSession, createSession } from "@/lib/session";
import { loadCustomRoles, capabilityOf } from "@/lib/permissions";
import type { Role } from "@/lib/enums";

/**
 * Switch the signed-in user's ACTIVE role to another they hold. Re-issues the
 * session cookie with the new active role and its route-guard capability — the
 * user's stored roles are unchanged, so this only changes their current view.
 */
export async function switchRole(key: string): Promise<{ ok?: boolean; error?: string }> {
  const s = await getSession();
  if (!s) return { error: "forbidden" };
  const keys = s.roleKeys ?? [s.activeRoleKey ?? s.role];
  if (!keys.includes(key)) return { error: "invalid" };

  const custom = await loadCustomRoles();
  const capability = capabilityOf(key, custom);
  await createSession({ ...s, role: capability as Role, activeRoleKey: key });
  revalidatePath("/", "layout");
  return { ok: true };
}
