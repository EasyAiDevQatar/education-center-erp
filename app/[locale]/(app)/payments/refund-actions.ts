"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { FINANCE_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { toNumber } from "@/lib/money";
import { guardArchived } from "@/lib/academic-year";
import { syncSessionPaymentStatus } from "@/lib/billing";
import { accountingEnabled, postSource, unpostSource } from "@/lib/accounting/journal-data";
import { linesForPayment } from "@/lib/accounting/posting";

export type VoidState = { ok?: boolean; error?: string };

/**
 * Undoing money is a finance decision, not a reception one — the roles that
 * may take a payment are not automatically the roles that may give it back.
 */
async function guard() {
  const s = await getSession();
  if (!s || !(FINANCE_ROLES as readonly string[]).includes(s.role)) return { error: "forbidden" };
  return null;
}

const voidSchema = z.object({
  id: z.string().min(1),
  /** Why. Not optional: a voided receipt with no reason is an argument later. */
  reason: z.string().trim().min(3).max(500),
});

const refundSchema = voidSchema.extend({
  /** Blank means the whole thing. */
  amount: z.coerce.number().positive().optional().nullable(),
});

/**
 * Release a payment's allocations and bring the sessions it paid for back to
 * whatever they now owe.
 *
 * Without this a cancelled receipt leaves its sessions marked PAID, which is
 * the worst of both worlds: the money is gone from the balance and the lesson
 * still looks settled, so nobody ever chases it.
 */
async function releaseAllocations(tx: Parameters<typeof syncSessionPaymentStatus>[0], paymentId: string) {
  const allocations = await tx.paymentAllocation.findMany({
    where: { paymentId },
    select: { sessionId: true },
  });
  await tx.paymentAllocation.deleteMany({ where: { paymentId } });
  for (const a of allocations) {
    if (a.sessionId) await syncSessionPaymentStatus(tx, a.sessionId);
  }
}

/**
 * The receipt was keyed in error and no money ever moved.
 *
 * The ledger entry is removed rather than reversed, because a reversal would
 * assert that cash arrived and left — and it did not.
 */
export async function cancelPayment(
  locale: string,
  input: z.infer<typeof voidSchema>,
): Promise<VoidState> {
  const denied = await guard();
  if (denied) return denied;
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return { error: "reasonRequired" };
  const { id, reason } = parsed.data;

  const payment = await db.payment.findUnique({ where: { id } });
  if (!payment) return { error: "notfound" };
  if (payment.status !== "COMPLETED") return { error: "alreadyVoided" };
  const frozen = await guardArchived(payment.date);
  if (frozen) return { error: frozen };

  const session = await getSession();
  await db.$transaction(async (tx) => {
    await releaseAllocations(tx, id);
    await tx.payment.update({
      where: { id },
      data: {
        status: "CANCELLED",
        voidReason: reason,
        voidedAt: new Date(),
        voidedById: session?.userId ?? null,
      },
    });
    if (await accountingEnabled()) await unpostSource(tx, "PAYMENT", id);
  });

  await writeAudit("Payment", id, "UPDATE", {
    before: { status: "COMPLETED", amount: toNumber(payment.amount) },
    after: { status: "CANCELLED", reason },
  });
  revalidatePath(`/${locale}/payments`);
  return { ok: true };
}

/**
 * The money arrived and is going back.
 *
 * The original entry stays and a reversing one is added, because that is what
 * happened and what an auditor needs to see. Cancelling would erase a real
 * movement of cash.
 */
export async function refundPayment(
  locale: string,
  input: z.infer<typeof refundSchema>,
): Promise<VoidState> {
  const denied = await guard();
  if (denied) return denied;
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) return { error: "reasonRequired" };
  const { id, reason } = parsed.data;

  const payment = await db.payment.findUnique({ where: { id } });
  if (!payment) return { error: "notfound" };
  if (payment.status !== "COMPLETED") return { error: "alreadyVoided" };
  const frozen = await guardArchived(payment.date);
  if (frozen) return { error: frozen };

  const full = toNumber(payment.amount);
  const amount = parsed.data.amount ?? full;
  if (amount > full) return { error: "refundTooLarge" };

  const session = await getSession();
  const now = new Date();
  await db.$transaction(async (tx) => {
    // A partial refund still releases the allocations: what remains may no
    // longer cover the sessions it was spread across, and re-spreading it
    // automatically would be guessing on the centre's behalf.
    await releaseAllocations(tx, id);
    await tx.payment.update({
      where: { id },
      data: {
        status: "REFUNDED",
        refundAmount: amount,
        voidReason: reason,
        voidedAt: now,
        voidedById: session?.userId ?? null,
      },
    });
    if (await accountingEnabled()) {
      // The same lines, the other way round: cash out, revenue reversed.
      const lines = linesForPayment({
        amount,
        method: payment.method,
        receiptNo: payment.receiptNo,
      }).map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
      await postSource(tx, {
        date: now,
        memo: `استرداد — إيصال ${payment.receiptNo}`,
        sourceType: "PAYMENT_REFUND",
        sourceId: id,
        lines,
      });
    }
  });

  await writeAudit("Payment", id, "UPDATE", {
    before: { status: "COMPLETED", amount: full },
    after: { status: "REFUNDED", refunded: amount, reason },
  });
  revalidatePath(`/${locale}/payments`);
  return { ok: true };
}
