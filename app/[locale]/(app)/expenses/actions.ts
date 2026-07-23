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
  supplierId: z.string().trim().optional().nullable(),
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
    supplierId: formData.get("supplierId") || null,
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
    supplierId: d.supplierId,
    receiptNo: d.receiptNo,
  };

  // Approval flow: with accounting on, new expenses start DRAFT and reach the
  // journal only through approveExpense. An edit to an already-POSTED expense
  // reposts in the same transaction so the books track the row.
  const posting = await accountingEnabled();
  let createdId: string | null = null;
  await db.$transaction(async (tx) => {
    if (id) {
      const updated = await tx.expense.update({ where: { id }, data });
      if (posting && updated.status === "POSTED") {
        await repostSource(tx, await expenseDraft(id, data.date, d.description, d.amount, d.categoryId));
      }
    } else {
      const created = await tx.expense.create({
        data: { ...data, status: posting ? "DRAFT" : "APPROVED" },
      });
      createdId = created.id;
    }
  });
  await writeAudit("Expense", id ?? createdId!, id ? "UPDATE" : "CREATE", { after: data });
  revalidatePath(`/${locale}/expenses`);
  return { ok: true };
}

async function expenseDraft(
  expenseId: string,
  date: Date,
  description: string,
  amount: number,
  categoryId: string,
) {
  const category = await db.expenseCategory.findUnique({
    where: { id: categoryId },
    include: { account: { select: { code: true } } },
  });
  return {
    date,
    memo: `مصروف — ${description}`,
    sourceType: "EXPENSE" as const,
    sourceId: expenseId,
    lines: linesForExpense({
      amount,
      categoryAccountCode: category?.account?.code ?? null,
    }),
  };
}

/** Approve a draft expense: post it to the journal and mark it POSTED, one tx.
 *  Re-approving is harmless — the [EXPENSE, id] unique makes the post a skip. */
export async function approveExpense(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  if (!(await accountingEnabled())) return { error: "notEnabled" };
  const expense = await db.expense.findUnique({ where: { id } });
  if (!expense) return { error: "notfound" };
  const frozen = await guardArchived(expense.date);
  if (frozen) return { error: frozen };

  const draft = await expenseDraft(
    id,
    expense.date,
    expense.description,
    Number(expense.amount),
    expense.categoryId,
  );
  await db.$transaction(async (tx) => {
    await postSource(tx, draft);
    await tx.expense.update({ where: { id }, data: { status: "POSTED" } });
  });
  await writeAudit("Expense", id, "UPDATE", { after: { status: "POSTED" } });
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
