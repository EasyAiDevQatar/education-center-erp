"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { guardArchived } from "@/lib/academic-year";
import { notifyPayment } from "@/lib/integrations/notify";
import { nextReceiptNo } from "@/lib/balances";
import { PAYMENT_METHODS } from "@/lib/enums";
import {
  accountingEnabled,
  postSource,
  repostSource,
  unpostSource,
} from "@/lib/accounting/journal-data";
import { linesForPayment } from "@/lib/accounting/posting";

export type ActionState = { ok?: boolean; error?: string };

const schema = z.object({
  date: z.string().min(1),
  studentId: z.string().min(1),
  amount: z.coerce.number().positive(),
  method: z.enum(PAYMENT_METHODS).default("CASH"),
  teacherId: z.string().trim().optional().nullable(),
  receiptNo: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

async function guard() {
  const s = await getSession();
  return !s || !STAFF_ROLES.includes(s.role);
}

export async function savePayment(
  locale: string,
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };

  const parsed = schema.safeParse({
    date: formData.get("date"),
    studentId: formData.get("studentId"),
    amount: formData.get("amount"),
    method: formData.get("method") || "CASH",
    teacherId: formData.get("teacherId") || null,
    receiptNo: formData.get("receiptNo") || null,
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) return { error: "invalid" };

  const d = parsed.data;
  const priorPayment = id ? await db.payment.findUnique({ where: { id } }) : null;
  const frozen = await guardArchived(new Date(d.date), priorPayment?.date);
  if (frozen) return { error: frozen };
  const data = {
    date: new Date(d.date),
    studentId: d.studentId,
    amount: d.amount,
    method: d.method,
    teacherId: d.teacherId || null,
    notes: d.notes,
  };

  // GL posting rides the same transaction as the payment write: an edit that
  // updated the row but failed to re-post would silently desync the books.
  const posting = await accountingEnabled();
  let createdId: string | null = null;
  try {
    await db.$transaction(async (tx) => {
      if (id) {
        const updated = await tx.payment.update({ where: { id }, data });
        if (posting) {
          await repostSource(tx, {
            date: data.date,
            memo: `دفعة — إيصال ${updated.receiptNo}`,
            sourceType: "PAYMENT",
            sourceId: id,
            lines: linesForPayment({
              amount: d.amount,
              method: d.method,
              receiptNo: updated.receiptNo,
            }),
          });
        }
      } else {
        const receiptNo = d.receiptNo?.trim() || (await nextReceiptNo());
        const created = await tx.payment.create({ data: { ...data, receiptNo } });
        createdId = created.id;
        if (posting) {
          await postSource(tx, {
            date: data.date,
            memo: `دفعة — إيصال ${receiptNo}`,
            sourceType: "PAYMENT",
            sourceId: created.id,
            lines: linesForPayment({ amount: d.amount, method: d.method, receiptNo }),
          });
        }
      }
    });
  } catch {
    // Unique receiptNo collision
    return { error: "duplicate" };
  }
  if (id) {
    await writeAudit("Payment", id, "UPDATE", { after: data });
  } else if (createdId) {
    await writeAudit("Payment", createdId, "CREATE", { after: data });
    await notifyPayment(createdId);
  }

  revalidatePath(`/${locale}/payments`);
  return { ok: true };
}

export async function deletePayment(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const prior = await db.payment.findUnique({ where: { id } });
  const frozen = await guardArchived(prior?.date);
  if (frozen) return { error: frozen };
  await db.$transaction(async (tx) => {
    await tx.payment.delete({ where: { id } });
    await unpostSource(tx, "PAYMENT", id);
  });
  await writeAudit("Payment", id, "DELETE");
  revalidatePath(`/${locale}/payments`);
  return { ok: true };
}
