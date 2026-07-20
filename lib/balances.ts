import "server-only";
import { db } from "./db";
import { toNumber } from "./money";

/** Charges (session totals) − payments = balance owed by the student. */
export async function getStudentBalance(studentId: string) {
  const [charges, paid] = await Promise.all([
    db.session.aggregate({ _sum: { total: true }, where: { studentId } }),
    db.payment.aggregate({ _sum: { amount: true }, where: { studentId } }),
  ]);
  const totalCharges = toNumber(charges._sum.total);
  const totalPaid = toNumber(paid._sum.amount);
  return { totalCharges, totalPaid, balance: totalCharges - totalPaid };
}

export type LedgerEntry = {
  date: string;
  type: "SESSION" | "PAYMENT";
  description: string;
  debit: number; // charges
  credit: number; // payments
  balance: number;
};

/** Chronological ledger of a student's charges and payments with running balance. */
export async function getStudentLedger(studentId: string): Promise<LedgerEntry[]> {
  const [sessions, payments] = await Promise.all([
    db.session.findMany({
      where: { studentId },
      include: { teacher: true, gradeLevel: true },
    }),
    db.payment.findMany({ where: { studentId } }),
  ]);

  const entries: Omit<LedgerEntry, "balance">[] = [
    ...sessions.map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      type: "SESSION" as const,
      description: `${s.teacher.name} · ${s.gradeLevel.nameAr}`,
      debit: toNumber(s.total),
      credit: 0,
    })),
    ...payments.map((p) => ({
      date: p.date.toISOString().slice(0, 10),
      type: "PAYMENT" as const,
      description: `#${p.receiptNo}`,
      debit: 0,
      credit: toNumber(p.amount),
    })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let running = 0;
  return entries.map((e) => {
    running += e.debit - e.credit;
    return { ...e, balance: running };
  });
}

/** Next receipt number = max existing numeric receipt + 1 (fallback 1001). */
export async function nextReceiptNo(): Promise<string> {
  const payments = await db.payment.findMany({ select: { receiptNo: true } });
  let max = 1000;
  for (const p of payments) {
    const n = parseInt(p.receiptNo, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return String(max + 1);
}
