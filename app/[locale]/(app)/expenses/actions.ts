"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { FINANCE_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { guardArchived } from "@/lib/academic-year";

export type ActionState = { ok?: boolean; error?: string };

const schema = z.object({
  date: z.string().min(1),
  description: z.string().trim().min(1),
  categoryId: z.string().min(1),
  amount: z.coerce.number().positive(),
  paidTo: z.string().trim().optional().nullable(),
  receiptNo: z.string().trim().optional().nullable(),
});

async function guard() {
  const s = await getSession();
  return !s || !FINANCE_ROLES.includes(s.role);
}

export async function saveExpense(
  locale: string,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = schema.safeParse({
    date: formData.get("date"),
    description: formData.get("description"),
    categoryId: formData.get("categoryId"),
    amount: formData.get("amount"),
    paidTo: formData.get("paidTo") || null,
    receiptNo: formData.get("receiptNo") || null,
  });
  if (!parsed.success) return { error: "invalid" };

  const d = parsed.data;
  const existingExpense = id ? await db.expense.findUnique({ where: { id } }) : null;
  const frozen = await guardArchived(new Date(d.date), existingExpense?.date);
  if (frozen) return { error: frozen };
  const data = {
    date: new Date(d.date),
    description: d.description,
    categoryId: d.categoryId,
    amount: d.amount,
    paidTo: d.paidTo,
    receiptNo: d.receiptNo,
  };
  if (id) {
    await db.expense.update({ where: { id }, data });
    await writeAudit("Expense", id, "UPDATE", { after: data });
  } else {
    const created = await db.expense.create({ data });
    await writeAudit("Expense", created.id, "CREATE", { after: data });
  }
  revalidatePath(`/${locale}/expenses`);
  return { ok: true };
}

export async function deleteExpense(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const existing = await db.expense.findUnique({ where: { id } });
  const frozen = await guardArchived(existing?.date);
  if (frozen) return { error: frozen };
  await db.expense.delete({ where: { id } });
  await writeAudit("Expense", id, "DELETE");
  revalidatePath(`/${locale}/expenses`);
  return { ok: true };
}
