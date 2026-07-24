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
import { syncSessionPaymentStatus } from "@/lib/billing";
import { validateAllocation, type SuggestedLine } from "@/lib/allocation";

export type ActionState = { ok?: boolean; error?: string };

/**
 * Read the per-session split the dialog posted.
 *
 * Absent means "the desk did not allocate" — a bare payment against the
 * balance, which is how every payment behaved before this existed. It must
 * stay valid: not every centre reconciles to the lesson.
 */
function parseAllocation(raw: FormDataEntryValue | null): SuggestedLine[] | null {
  const text = (raw ?? "").toString().trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { sessionId?: string; amount?: number }[];
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((l) => typeof l?.sessionId === "string" && Number.isFinite(Number(l?.amount)))
      .map((l) => ({
        sessionId: String(l.sessionId),
        amount: Math.round(Number(l.amount) * 100) / 100,
        partial: false,
      }))
      .filter((l) => l.amount > 0.005);
  } catch {
    return null;
  }
}

const schema = z.object({
  date: z.string().min(1),
  studentId: z.string().min(1),
  amount: z.coerce.number().positive(),
  method: z.enum(PAYMENT_METHODS).default("CASH"),
  teacherId: z.string().trim().optional().nullable(),
  receiptNo: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  // Cheque details, read only when method === CHEQUE.
  chequeNo: z.string().trim().optional().nullable(),
  chequeBank: z.string().trim().optional().nullable(),
  chequeDueDate: z.string().trim().optional().nullable(),
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
    chequeNo: formData.get("chequeNo") || null,
    chequeBank: formData.get("chequeBank") || null,
    chequeDueDate: formData.get("chequeDueDate") || null,
  });
  if (!parsed.success) return { error: "invalid" };
  if (parsed.data.method === "CHEQUE" && !id && !parsed.data.chequeNo?.trim()) {
    return { error: "chequeNoRequired" };
  }

  const d = parsed.data;
  const allocation = parseAllocation(formData.get("allocations"));
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
        // A cheque payment carries its own tracked cheque through the
        // lifecycle (deposit → clear / bounce). Created RECEIVED.
        if (d.method === "CHEQUE" && d.chequeNo?.trim()) {
          await tx.cheque.create({
            data: {
              direction: "INCOMING",
              status: "RECEIVED",
              chequeNo: d.chequeNo.trim(),
              amount: d.amount,
              bankName: d.chequeBank,
              studentId: d.studentId,
              paymentId: created.id,
              receivedDate: data.date,
              dueDate: d.chequeDueDate ? new Date(`${d.chequeDueDate}T00:00:00.000Z`) : null,
              events: { create: { toStatus: "RECEIVED" } },
            },
          });
        }
      }

      // Allocation is re-checked here against live outstanding figures, never
      // trusted from the form: the browser could be minutes stale, and an
      // over-allocation would mark a lesson paid that is not.
      if (allocation) {
        const paymentId = id ?? createdId!;
        // Replacing wholesale keeps an edited payment's split consistent with
        // its new amount instead of layering a second allocation on top.
        await tx.paymentAllocation.deleteMany({ where: { paymentId } });

        const touched = new Set(allocation.map((l) => l.sessionId));
        const rows = await tx.session.findMany({
          where: { id: { in: [...touched] }, studentId: d.studentId },
          include: { allocations: { where: { paymentId: { not: paymentId } } } },
        });
        const payable = rows.map((r) => {
          const other = r.allocations.reduce((a, x) => a + Number(x.amount), 0);
          const total = Number(r.total);
          return {
            id: r.id,
            date: r.date.toISOString().slice(0, 10),
            teacherId: r.teacherId,
            teacherName: "",
            total,
            allocated: other,
            outstanding: Math.round(Math.max(0, total - other) * 100) / 100,
          };
        });

        const check = validateAllocation(payable, allocation, d.amount);
        if (!check.ok) throw new Error(check.error ?? "invalid");

        for (const line of allocation) {
          await tx.paymentAllocation.create({
            data: { paymentId, sessionId: line.sessionId, amount: line.amount },
          });
        }
        // Every touched session re-derives its own status from its allocations.
        for (const sessionId of touched) {
          await syncSessionPaymentStatus(tx, sessionId);
        }
      }
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "overSession" || msg === "overPayment") return { error: msg };
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
    // A linked incoming cheque is meaningless without its payment: remove it
    // and any ledger hops it posted before the payment row goes.
    const cheque = await tx.cheque.findUnique({ where: { paymentId: id } });
    if (cheque) {
      for (const status of ["DEPOSITED", "CLEARED", "BOUNCED"]) {
        await unpostSource(tx, "CHEQUE", `${cheque.id}:${status}`);
      }
      await tx.cheque.delete({ where: { id: cheque.id } });
    }
    await tx.payment.delete({ where: { id } });
    await unpostSource(tx, "PAYMENT", id);
  });
  await writeAudit("Payment", id, "DELETE");
  revalidatePath(`/${locale}/payments`);
  return { ok: true };
}
