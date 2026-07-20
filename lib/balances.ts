import "server-only";
import { db } from "./db";
import { toNumber } from "./money";

/**
 * Charges − payments = balance owed by the student.
 *
 * Two rules keep this honest:
 *  - Planner DRAFT sessions are unconfirmed plans and never count as charges.
 *  - Sessions covered by a package are NOT charged individually; the package's
 *    purchase price is the charge instead (otherwise the student pays twice).
 */
export async function getStudentBalance(studentId: string) {
  const [charges, packages, paid] = await Promise.all([
    db.session.aggregate({
      _sum: { total: true },
      where: { studentId, status: { not: "DRAFT" }, packageId: null },
    }),
    db.package.aggregate({ _sum: { price: true }, where: { studentId } }),
    db.payment.aggregate({ _sum: { amount: true }, where: { studentId } }),
  ]);
  const totalCharges =
    toNumber(charges._sum.total) + toNumber(packages._sum.price);
  const totalPaid = toNumber(paid._sum.amount);
  return { totalCharges, totalPaid, balance: totalCharges - totalPaid };
}

export type LedgerEntry = {
  date: string;
  type: "SESSION" | "PAYMENT" | "PACKAGE";
  description: string;
  debit: number; // charges
  credit: number; // payments
  balance: number;
};

/** Chronological ledger of a student's charges and payments with running balance. */
export async function getStudentLedger(studentId: string): Promise<LedgerEntry[]> {
  const [sessions, packages, payments] = await Promise.all([
    db.session.findMany({
      where: { studentId, status: { not: "DRAFT" }, packageId: null },
      include: { teacher: true, gradeLevel: true },
    }),
    db.package.findMany({ where: { studentId } }),
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
    ...packages.map((p) => ({
      date: p.purchasedAt.toISOString().slice(0, 10),
      type: "PACKAGE" as const,
      description: `باقة ${toNumber(p.totalHours)} ساعة`,
      debit: toNumber(p.price),
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
