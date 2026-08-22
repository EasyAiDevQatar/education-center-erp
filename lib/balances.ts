import "server-only";
import { db } from "./db";
import { toNumber } from "./money";
import { unchargeableStatuses, netPaid, LIVE_PAYMENTS } from "./billing";

/**
 * Charges − payments = balance owed by the student.
 *
 * Three rules keep this honest:
 *  - A lesson that was not delivered is not a charge — see
 *    `unchargeableStatuses`. This used to exclude DRAFT only, which meant a
 *    cancelled lesson and an unbilled no-show were both shown to the parent as
 *    money owed, printed on their statement and chased by the nightly reminder
 *    — while the allocation screen refused to let anyone pay it, because it
 *    was already applying the correct rule. The balance was unpayable by
 *    construction.
 *  - Sessions covered by a package are NOT charged individually; the package's
 *    purchase price is the charge instead (otherwise the student pays twice).
 *  - The split is returned as well as the total, so a figure that looks wrong
 *    can be read rather than guessed at.
 */
export async function getStudentBalance(studentId: string) {
  const skip = await unchargeableStatuses();
  const [charges, packages, paid] = await Promise.all([
    db.session.aggregate({
      _sum: { total: true },
      where: { studentId, status: { notIn: skip }, packageId: null },
    }),
    db.package.aggregate({ _sum: { price: true }, where: { studentId } }),
    netPaid({ studentId }),
  ]);
  const lessonCharges = toNumber(charges._sum.total);
  const packageCharges = toNumber(packages._sum.price);
  const totalCharges = lessonCharges + packageCharges;
  const totalPaid = paid;
  return {
    lessonCharges,
    packageCharges,
    totalCharges,
    totalPaid,
    balance: totalCharges - totalPaid,
  };
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
      // Same rule as the balance above; a ledger that lists charges the
      // balance does not count is a ledger nobody can reconcile.
      where: { studentId, status: { notIn: await unchargeableStatuses() }, packageId: null },
      include: { teacher: true, gradeLevel: true },
    }),
    db.package.findMany({ where: { studentId } }),
    // Cancelled receipts are not entries in anybody's ledger; a refund shows as
    // its own line below, so the original stays as the collection it was.
    db.payment.findMany({ where: { studentId, ...LIVE_PAYMENTS } }),
  ]);

  const entries: Omit<LedgerEntry, "balance">[] = [
    ...sessions.map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      type: "SESSION" as const,
      description: `${s.teacher?.name ?? ""} · ${s.gradeLevel.nameAr}`,
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
