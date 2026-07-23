"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { FINANCE_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { guardArchived } from "@/lib/academic-year";
import { toNumber } from "@/lib/money";
import {
  accountingEnabled,
  postSource,
  unpostSource,
} from "@/lib/accounting/journal-data";
import { linesForChequeEvent, linesForExpense } from "@/lib/accounting/posting";
import { canTransition, validateChequeDates } from "@/lib/accounting/cheques";
import type { ChequeStatus, ChequeDirection } from "@/lib/enums";

export type ChequeState = { ok?: boolean; error?: string };

async function guard() {
  const s = await getSession();
  if (!s || !FINANCE_ROLES.includes(s.role)) return true;
  return !(await accountingEnabled());
}

/* ---------------- cheque books ---------------- */

const bookSchema = z
  .object({
    bankName: z.string().trim().min(1),
    accountNo: z.string().trim().optional().nullable(),
    startNo: z.coerce.number().int().min(1),
    endNo: z.coerce.number().int().min(1),
    notes: z.string().trim().optional().nullable(),
  })
  .refine((d) => d.endNo >= d.startNo, { message: "range" });

export async function saveChequeBook(
  locale: string,
  id: string | null,
  _prev: ChequeState,
  formData: FormData,
): Promise<ChequeState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = bookSchema.safeParse({
    bankName: formData.get("bankName"),
    accountNo: formData.get("accountNo") || null,
    startNo: formData.get("startNo"),
    endNo: formData.get("endNo"),
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  if (id) {
    const book = await db.chequeBook.findUnique({ where: { id } });
    if (!book) return { error: "notfound" };
    // Never move nextNo backwards below what was already issued.
    await db.chequeBook.update({
      where: { id },
      data: { bankName: d.bankName, accountNo: d.accountNo, endNo: d.endNo, notes: d.notes },
    });
    await writeAudit("ChequeBook", id, "UPDATE", { after: d });
  } else {
    const created = await db.chequeBook.create({
      data: { ...d, nextNo: d.startNo },
    });
    await writeAudit("ChequeBook", created.id, "CREATE", { after: d });
  }
  revalidatePath(`/${locale}/accounting/cheques`);
  return { ok: true };
}

/* ---------------- outgoing cheques ---------------- */

const outgoingSchema = z.object({
  bookId: z.string().min(1),
  amount: z.coerce.number().positive(),
  payeeName: z.string().trim().min(1),
  supplierId: z.string().trim().optional().nullable(),
  dueDate: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

/**
 * Issue an outgoing cheque: consumes the book's next leaf inside the
 * transaction (bookExhausted past endNo). No ledger entry here — the expense
 * or payslip it settles carries the 2110 credit; the cheque only adds the
 * clearing hop later.
 */
export async function createOutgoingCheque(
  locale: string,
  _prev: ChequeState,
  formData: FormData,
): Promise<ChequeState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = outgoingSchema.safeParse({
    bookId: formData.get("bookId"),
    amount: formData.get("amount"),
    payeeName: formData.get("payeeName"),
    supplierId: formData.get("supplierId") || null,
    dueDate: formData.get("dueDate") || null,
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;
  const session = await getSession();

  try {
    await db.$transaction(async (tx) => {
      const book = await tx.chequeBook.findUnique({ where: { id: d.bookId } });
      if (!book || !book.active) throw new Error("notfound");
      if (book.nextNo > book.endNo) throw new Error("bookExhausted");
      await tx.chequeBook.update({
        where: { id: book.id },
        data: { nextNo: book.nextNo + 1 },
      });
      const cheque = await tx.cheque.create({
        data: {
          direction: "OUTGOING",
          status: "RECEIVED", // handed over on issue
          chequeNo: String(book.nextNo),
          amount: d.amount,
          bankName: book.bankName,
          payeeName: d.payeeName,
          bookId: book.id,
          supplierId: d.supplierId,
          issueDate: new Date(),
          dueDate: d.dueDate ? new Date(`${d.dueDate}T00:00:00.000Z`) : null,
          notes: d.notes,
          createdById: session?.userId ?? null,
          events: { create: { toStatus: "RECEIVED", byUserId: session?.userId ?? null } },
        },
      });
      await writeAudit("Cheque", cheque.id, "CREATE", {
        after: { chequeNo: cheque.chequeNo, amount: d.amount, payee: d.payeeName },
      });
    });
  } catch (err) {
    const msg = (err as Error).message;
    return { error: msg === "bookExhausted" || msg === "notfound" ? msg : "invalid" };
  }
  revalidatePath(`/${locale}/accounting/cheques`);
  return { ok: true };
}

/* ---------------- lifecycle transitions ---------------- */

const transitionSchema = z.object({
  chequeId: z.string().min(1),
  toStatus: z.string().min(1),
  note: z.string().trim().optional().nullable(),
  bounceFee: z.coerce.number().min(0).default(0),
});

/**
 * Move a cheque along its lifecycle. Posts the policy ledger hops with
 * `sourceId = ${chequeId}:${toStatus}` (idempotent per hop). A BOUNCED
 * incoming cheque UNWINDS: the linked payment is deleted (restoring the
 * student's balance through the normal machinery) and its entry plus all
 * cheque hops are unposted — only the bounce fee remains on the books.
 */
export async function transitionCheque(
  locale: string,
  input: z.infer<typeof transitionSchema>,
): Promise<ChequeState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;
  const session = await getSession();

  const cheque = await db.cheque.findUnique({ where: { id: d.chequeId } });
  if (!cheque) return { error: "notfound" };
  const direction = cheque.direction as ChequeDirection;
  const from = cheque.status as ChequeStatus;
  const to = d.toStatus as ChequeStatus;
  if (!canTransition(direction, from, to)) return { error: "badTransition" };

  const now = new Date();
  const dates = {
    receivedDate: to === "RECEIVED" ? now : cheque.receivedDate,
    depositDate: to === "DEPOSITED" ? now : cheque.depositDate,
    clearanceDate: to === "CLEARED" ? now : cheque.clearanceDate,
  };
  const dateErr = validateChequeDates(dates);
  if (dateErr) return { error: dateErr };

  const frozen = await guardArchived(now);
  if (frozen) return { error: frozen };

  const wasDeposited = from === "DEPOSITED" || !!cheque.depositDate;

  await db.$transaction(async (tx) => {
    await tx.cheque.update({
      where: { id: cheque.id },
      data: {
        status: to,
        ...dates,
        bounceDate: to === "BOUNCED" ? now : cheque.bounceDate,
        bounceReason: to === "BOUNCED" ? d.note : cheque.bounceReason,
        bounceFee: to === "BOUNCED" ? d.bounceFee : undefined,
        events: {
          create: {
            fromStatus: from,
            toStatus: to,
            note: d.note,
            byUserId: session?.userId ?? null,
          },
        },
      },
    });

    if (to === "BOUNCED" && direction === "INCOMING") {
      // Unwind: books and balances both forget the failed payment.
      for (const status of ["DEPOSITED", "CLEARED"]) {
        await unpostSource(tx, "CHEQUE", `${cheque.id}:${status}`);
      }
      if (cheque.paymentId) {
        await unpostSource(tx, "PAYMENT", cheque.paymentId);
        // Detach first — the FK would otherwise block the delete.
        await tx.cheque.update({ where: { id: cheque.id }, data: { paymentId: null } });
        await tx.payment.delete({ where: { id: cheque.paymentId } });
      }
    }

    const lines = linesForChequeEvent({
      direction,
      toStatus: to,
      amount: toNumber(cheque.amount),
      wasDeposited,
      bounceFee: d.bounceFee,
    });
    if (lines) {
      await postSource(tx, {
        date: now,
        memo: `شيك ${cheque.chequeNo} — ${to}`,
        sourceType: "CHEQUE",
        sourceId: `${cheque.id}:${to}`,
        lines,
      });
    }
  });

  await writeAudit("Cheque", cheque.id, "UPDATE", {
    after: { from, to, note: d.note ?? undefined },
  });
  revalidatePath(`/${locale}/accounting/cheques`);
  revalidatePath(`/${locale}/payments`);
  return { ok: true };
}

/* ---------------- pay an expense by outgoing cheque ---------------- */

const payExpenseSchema = z.object({
  expenseId: z.string().min(1),
  bookId: z.string().min(1),
});

/**
 * Settle an APPROVED/DRAFT expense with an outgoing cheque: issues the leaf,
 * links it, and posts the expense against 2110 cheques-issued (instead of
 * cash) — one transaction, marks the expense POSTED.
 */
export async function payExpenseByCheque(
  locale: string,
  input: z.infer<typeof payExpenseSchema>,
): Promise<ChequeState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = payExpenseSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;
  const session = await getSession();

  const expense = await db.expense.findUnique({
    where: { id: d.expenseId },
    include: {
      category: { include: { account: { select: { code: true } } } },
      supplier: { select: { name: true } },
      cheque: true,
    },
  });
  if (!expense) return { error: "notfound" };
  if (expense.cheque) return { error: "alreadyCheque" };
  const frozen = await guardArchived(expense.date);
  if (frozen) return { error: frozen };

  try {
    await db.$transaction(async (tx) => {
      const book = await tx.chequeBook.findUnique({ where: { id: d.bookId } });
      if (!book || !book.active) throw new Error("notfound");
      if (book.nextNo > book.endNo) throw new Error("bookExhausted");
      await tx.chequeBook.update({ where: { id: book.id }, data: { nextNo: book.nextNo + 1 } });
      await tx.cheque.create({
        data: {
          direction: "OUTGOING",
          status: "RECEIVED",
          chequeNo: String(book.nextNo),
          amount: expense.amount,
          bankName: book.bankName,
          payeeName: expense.supplier?.name ?? expense.paidTo ?? expense.description,
          bookId: book.id,
          supplierId: expense.supplierId,
          expenseId: expense.id,
          issueDate: new Date(),
          createdById: session?.userId ?? null,
          events: { create: { toStatus: "RECEIVED", byUserId: session?.userId ?? null } },
        },
      });
      // Repost against 2110 (delete any cash-side entry from an earlier
      // approval, then post the cheque-side one).
      await unpostSource(tx, "EXPENSE", expense.id);
      await postSource(tx, {
        date: expense.date,
        memo: `مصروف — ${expense.description}`,
        sourceType: "EXPENSE",
        sourceId: expense.id,
        lines: linesForExpense({
          amount: toNumber(expense.amount),
          categoryAccountCode: expense.category?.account?.code ?? null,
          viaCheque: true,
        }),
      });
      await tx.expense.update({ where: { id: expense.id }, data: { status: "POSTED" } });
    });
  } catch (err) {
    const msg = (err as Error).message;
    return { error: msg === "bookExhausted" || msg === "notfound" ? msg : "invalid" };
  }
  await writeAudit("Expense", expense.id, "UPDATE", { after: { paidByCheque: true } });
  revalidatePath(`/${locale}/accounting/cheques`);
  revalidatePath(`/${locale}/expenses`);
  return { ok: true };
}
