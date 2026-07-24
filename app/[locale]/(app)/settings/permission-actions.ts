"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { BUILTIN_ROLES, loadCustomRoles, loadRolePermissions } from "@/lib/permissions";

export type ActionState = { ok?: boolean; error?: string };

async function adminOnly() {
  const s = await getSession();
  return s && s.role === "ADMIN" ? s : null;
}

/**
 * Save the whole matrix: built-in role menus go to the rolePermissions setting;
 * each custom role's menu goes to its own row. Admin only, and it can only
 * narrow — the route guards remain the real gate.
 */
export async function saveRoleMatrix(input: {
  builtin: Record<string, Record<string, boolean>>;
  custom: Record<string, Record<string, boolean>>;
}): Promise<ActionState> {
  const s = await adminOnly();
  if (!s) return { error: "forbidden" };

  const clean: Record<string, Record<string, boolean>> = {};
  for (const [role, map] of Object.entries(input.builtin ?? {})) {
    if (role === "ADMIN") continue;
    clean[role] = {};
    for (const [k, v] of Object.entries(map ?? {})) clean[role][k] = !!v;
  }
  const value = JSON.stringify(clean);
  await db.setting.upsert({
    where: { key: "rolePermissions" },
    create: { key: "rolePermissions", value },
    update: { value },
  });

  for (const [key, map] of Object.entries(input.custom ?? {})) {
    const clean2: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(map ?? {})) clean2[k] = !!v;
    await db.customRole
      .update({ where: { key }, data: { permissions: JSON.stringify(clean2) } })
      .catch(() => {});
  }
  await writeAudit("CustomRole", "matrix", "UPDATE", {});
  revalidatePath("/", "layout");
  return { ok: true };
}

const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "role";

const createSchema = z.object({
  name: z.string().min(1),
  nameEn: z.string().optional().nullable(),
  baseRole: z.enum(["ADMIN", "ACCOUNTANT", "RECEPTIONIST", "TEACHER", "PARENT", "DRIVER"]),
  copyFrom: z.string().optional().nullable(),
});

/** Create a custom role, optionally duplicating another role's menu. */
export async function createCustomRole(input: z.infer<typeof createSchema>): Promise<ActionState> {
  const s = await adminOnly();
  if (!s) return { error: "forbidden" };
  const p = createSchema.safeParse(input);
  if (!p.success) return { error: "invalid" };
  const d = p.data;

  const base = slug(d.nameEn || d.name);
  let key = base;
  let n = 1;
  while (await db.customRole.findUnique({ where: { key } })) key = `${base}-${++n}`;

  let perms: Record<string, boolean> = {};
  if (d.copyFrom) {
    if ((BUILTIN_ROLES as readonly string[]).includes(d.copyFrom)) {
      perms = (await loadRolePermissions())[d.copyFrom] ?? {};
    } else {
      perms = (await loadCustomRoles()).find((x) => x.key === d.copyFrom)?.permissions ?? {};
    }
  }

  await db.customRole.create({
    data: {
      key,
      name: d.name,
      nameEn: d.nameEn || null,
      baseRole: d.baseRole,
      permissions: JSON.stringify(perms),
    },
  });
  await writeAudit("CustomRole", key, "CREATE", { after: { name: d.name, baseRole: d.baseRole } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteCustomRole(id: string): Promise<ActionState> {
  const s = await adminOnly();
  if (!s) return { error: "forbidden" };
  const r = await db.customRole.findUnique({ where: { id } });
  if (!r) return { error: "invalid" };
  await db.customRole.delete({ where: { id } });
  await writeAudit("CustomRole", r.key, "DELETE", {});
  revalidatePath("/", "layout");
  return { ok: true };
}
