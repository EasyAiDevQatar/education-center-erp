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

  try {
    if (id) {
      await db.payment.update({ where: { id }, data });
      await writeAudit("Payment", id, "UPDATE", { after: data });
    } else {
      const receiptNo = d.receiptNo?.trim() || (await nextReceiptNo());
      const created = await db.payment.create({ data: { ...data, receiptNo } });
      await writeAudit("Payment", created.id, "CREATE", { after: { ...data, receiptNo } });
      await notifyPayment(created.id);
    }
  } catch (e) {
    // Unique receiptNo collision
    return { error: "duplicate" };
  }

  revalidatePath(`/${locale}/payments`);
  return { ok: true };
}

export async function deletePayment(locale: string, id: string): Promise<ActionState> {
  if (await guard()) return { error: "forbidden" };
  const prior = await db.payment.findUnique({ where: { id } });
  const frozen = await guardArchived(prior?.date);
  if (frozen) return { error: frozen };
  await db.payment.delete({ where: { id } });
  await writeAudit("Payment", id, "DELETE");
  revalidatePath(`/${locale}/payments`);
  return { ok: true };
}
