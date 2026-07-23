"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { FINANCE_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { accountingEnabled } from "@/lib/accounting/journal-data";

export type ActionState = { ok?: boolean; error?: string };

const schema = z.object({
  name: z.string().trim().min(1),
  nameEn: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().email().optional().nullable().or(z.literal("").transform(() => null)),
  taxNo: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  active: z.coerce.boolean().default(true),
});

async function guard() {
  const s = await getSession();
  if (!s || !FINANCE_ROLES.includes(s.role)) return true;
  return !(await accountingEnabled());
}

export async function saveSupplier(
  locale: string,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = schema.safeParse({
    name: formData.get("name"),
    nameEn: formData.get("nameEn") || null,
    phone: formData.get("phone") || null,
    email: formData.get("email") || "",
    taxNo: formData.get("taxNo") || null,
    address: formData.get("address") || null,
    notes: formData.get("notes") || null,
    active: formData.get("active") === "on" || formData.get("active") === "true",
  });
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  if (id) {
    await db.supplier.update({ where: { id }, data: d });
    await writeAudit("Supplier", id, "UPDATE", { after: d });
  } else {
    const created = await db.supplier.create({ data: d });
    await writeAudit("Supplier", created.id, "CREATE", { after: d });
  }
  revalidatePath(`/${locale}/accounting/suppliers`);
  return { ok: true };
}

export async function deleteSupplier(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const supplier = await db.supplier.findUnique({
    where: { id },
    include: { _count: { select: { expenses: true } } },
  });
  if (!supplier) return { error: "notfound" };
  // Vendors with history stay for the audit trail — deactivate instead.
  if (supplier._count.expenses > 0) return { error: "supplierInUse" };
  await db.supplier.delete({ where: { id } });
  await writeAudit("Supplier", id, "DELETE");
  revalidatePath(`/${locale}/accounting/suppliers`);
  return { ok: true };
}
