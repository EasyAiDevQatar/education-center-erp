"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";

export type ActionState = { ok?: boolean; error?: string };

/**
 * Save the role→module access matrix. Admin only. The matrix can only *narrow*
 * a role: the nav still applies each module's own role list first, so an entry
 * here can hide a module a role has, never grant one it doesn't — the existing
 * route guards remain the real gate.
 */
export async function saveRolePermissions(
  perms: Record<string, Record<string, boolean>>,
): Promise<ActionState> {
  const s = await getSession();
  if (!s || s.role !== "ADMIN") return { error: "forbidden" };

  const clean: Record<string, Record<string, boolean>> = {};
  for (const [role, map] of Object.entries(perms ?? {})) {
    if (role === "ADMIN") continue; // never restrict admin
    clean[role] = {};
    for (const [k, v] of Object.entries(map ?? {})) clean[role][k] = !!v;
  }
  const value = JSON.stringify(clean);
  await db.setting.upsert({
    where: { key: "rolePermissions" },
    create: { key: "rolePermissions", value },
    update: { value },
  });
  await writeAudit("Setting", "rolePermissions", "UPDATE", { after: clean });
  // Refresh every layout so the sidebar reflects the change immediately.
  revalidatePath("/", "layout");
  return { ok: true };
}
