"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { FINANCE_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { ACCOUNT_TYPES } from "@/lib/enums";
import { accountingEnabled } from "@/lib/accounting/journal-data";

export type ActionState = { ok?: boolean; error?: string };

const schema = z.object({
  code: z.string().trim().regex(/^\d{3,6}$/),
  nameAr: z.string().trim().min(1),
  nameEn: z.string().trim().min(1),
  type: z.enum(ACCOUNT_TYPES),
  parentId: z.string().trim().optional().nullable(),
  active: z.coerce.boolean().default(true),
  notes: z.string().trim().optional().nullable(),
});

async function guard() {
  const s = await getSession();
  if (!s || !FINANCE_ROLES.includes(s.role)) return true;
  return !(await accountingEnabled());
}

export async function saveAccount(
  locale: string,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = schema.safeParse({
    code: formData.get("code"),
    nameAr: formData.get("nameAr"),
    nameEn: formData.get("nameEn"),
    type: formData.get("type"),
    parentId: formData.get("parentId") || null,
    active: formData.get("active") === "on" || formData.get("active") === "true",
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  if (d.parentId) {
    const parent = await db.account.findUnique({ where: { id: d.parentId } });
    // Same-type parents only — a rent account under an asset heading would
    // corrupt every rollup that walks the tree.
    if (!parent || parent.type !== d.type || parent.id === id) {
      return { error: "invalidParent" };
    }
  }

  if (id) {
    const existing = await db.account.findUnique({ where: { id } });
    if (!existing) return { error: "notfound" };
    // System accounts keep their code and type — posting rules key on them.
    const data = existing.system
      ? { nameAr: d.nameAr, nameEn: d.nameEn, parentId: d.parentId, active: d.active, notes: d.notes }
      : { ...d };
    try {
      await db.account.update({ where: { id }, data });
    } catch {
      return { error: "duplicateCode" };
    }
    await writeAudit("Account", id, "UPDATE", { after: data });
  } else {
    try {
      const created = await db.account.create({ data: { ...d } });
      await writeAudit("Account", created.id, "CREATE", { after: d });
    } catch {
      return { error: "duplicateCode" };
    }
  }

  revalidatePath(`/${locale}/accounting/accounts`);
  return { ok: true };
}

export async function deleteAccount(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const account = await db.account.findUnique({
    where: { id },
    include: { _count: { select: { lines: true, children: true, expenseCategories: true } } },
  });
  if (!account) return { error: "notfound" };
  // Seeded accounts and anything with history stay: deactivate instead.
  if (account.system) return { error: "systemAccount" };
  if (account._count.lines > 0 || account._count.children > 0 || account._count.expenseCategories > 0) {
    return { error: "accountInUse" };
  }
  await db.account.delete({ where: { id } });
  await writeAudit("Account", id, "DELETE");
  revalidatePath(`/${locale}/accounting/accounts`);
  return { ok: true };
}
