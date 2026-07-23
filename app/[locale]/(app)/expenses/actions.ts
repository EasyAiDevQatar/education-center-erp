"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { FINANCE_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { guardArchived } from "@/lib/academic-year";
import {
  accountingEnabled,
  postSource,
  repostSource,
  unpostSource,
} from "@/lib/accounting/journal-data";
import { linesForExpense } from "@/lib/accounting/posting";

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
  // Category→account mapping resolved once; the posting builder falls back to
  // 5900 when the category was never mapped.
  const posting = await accountingEnabled();
  const category = posting
    ? await db.expenseCategory.findUnique({
        where: { id: d.categoryId },
        include: { account: { select: { code: true } } },
      })
    : null;
  const draft = (expenseId: string) => ({
    date: data.date,
    memo: `مصروف — ${d.description}`,
    sourceType: "EXPENSE" as const,
    sourceId: expenseId,
    lines: linesForExpense({
      amount: d.amount,
      categoryAccountCode: category?.account?.code ?? null,
    }),
  });

  let createdId: string | null = null;
  await db.$transaction(async (tx) => {
    if (id) {
      await tx.expense.update({ where: { id }, data });
      if (posting) await repostSource(tx, draft(id));
    } else {
      const created = await tx.expense.create({ data });
      createdId = created.id;
      if (posting) await postSource(tx, draft(created.id));
    }
  });
  await writeAudit("Expense", id ?? createdId!, id ? "UPDATE" : "CREATE", { after: data });
  revalidatePath(`/${locale}/expenses`);
  return { ok: true };
}

export async function deleteExpense(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const existing = await db.expense.findUnique({ where: { id } });
  const frozen = await guardArchived(existing?.date);
  if (frozen) return { error: frozen };
  await db.$transaction(async (tx) => {
    await tx.expense.delete({ where: { id } });
    await unpostSource(tx, "EXPENSE", id);
  });
  await writeAudit("Expense", id, "DELETE");
  revalidatePath(`/${locale}/expenses`);
  return { ok: true };
}
