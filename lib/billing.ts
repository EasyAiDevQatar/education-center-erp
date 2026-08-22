import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { toNumber } from "./money";
import { paymentStatusFor, packageStatusFor } from "./billing-rules";

// Re-exported so callers have one billing entry point on the server.
export { paymentStatusFor, packageStatusFor, autoAllocate } from "./billing-rules";
import { resolveNoShowPolicy, noShowIsChargeable, unbilledStatuses } from "./attendance-policy";

/**
 * The centre's no-show rule. One settings row, read where money is decided
 * rather than passed down from a UI that might be showing something stale.
 */
export async function noShowPolicy() {
  const row = await db.setting.findUnique({ where: { key: "noShowPolicy" } });
  return resolveNoShowPolicy(row?.value);
}

/**
 * The session statuses that are not a charge — the one place that decides it.
 *
 * There used to be three answers to this question and they disagreed. The
 * student's ledger excluded only DRAFT, so a cancelled or unbilled no-show
 * still appeared as money owed; the allocation screen excluded those statuses,
 * so nobody could ever pay that money off; and payroll excluded a different set
 * again, so the teacher was paid commission on a lesson the parent was never
 * charged for. Every money path now asks this function instead of writing its
 * own list, which is what stops them drifting apart again.
 *
 *  - DRAFT      unconfirmed planner rows; never money.
 *  - CANCELLED  the lesson did not happen and nobody is charged for it.
 *  - NO_SHOW    only when the centre's policy says a no-show is not billed.
 */
export async function unchargeableStatuses(): Promise<string[]> {
  return unbilledStatuses(await noShowPolicy(), ["DRAFT", "CANCELLED"]);
}

/**
 * Receipts that are still money.
 *
 * A cancelled receipt was keyed in error and never represented cash, so it
 * counts nothing anywhere. A refunded one did represent cash and now
 * represents less of it, which is why the refund is subtracted rather than the
 * whole receipt being dropped — the collection still happened and the day it
 * happened still had it.
 */
export const LIVE_PAYMENTS = { status: { not: "CANCELLED" } } as const;

/**
 * What the centre kept, for any slice of payments.
 *
 * Every screen that sums money asks this rather than aggregating `amount`
 * itself. Eighteen call sites summed the column directly, and a refund would
 * have been invisible to every one of them — the same shape as the dues bug,
 * where four readers each had their own idea of what counted.
 */
export async function netPaid(where: Prisma.PaymentWhereInput = {}): Promise<number> {
  const [gross, returned] = await Promise.all([
    db.payment.aggregate({ _sum: { amount: true }, where: { ...where, ...LIVE_PAYMENTS } }),
    db.payment.aggregate({
      _sum: { refundAmount: true },
      where: { ...where, status: "REFUNDED" },
    }),
  ]);
  return toNumber(gross._sum.amount) - toNumber(returned._sum.refundAmount);
}

/* --------------------------- package application ---------------------------- */

type Tx = Prisma.TransactionClient;

/**
 * Deduct a session's hours from its package the first time it becomes billable
 * (COMPLETED). Idempotent via `Session.packageApplied`.
 */
export async function applyPackageHours(tx: Tx, sessionId: string): Promise<void> {
  const s = await tx.session.findUnique({
    where: { id: sessionId },
    select: { id: true, packageId: true, hours: true, packageApplied: true },
  });
  if (!s || !s.packageId || s.packageApplied) return;

  const pkg = await tx.package.findUnique({ where: { id: s.packageId } });
  if (!pkg) return;

  const used = toNumber(pkg.hoursUsed) + toNumber(s.hours);
  await tx.package.update({
    where: { id: pkg.id },
    data: {
      hoursUsed: used,
      status: packageStatusFor(toNumber(pkg.totalHours), used, pkg.expiresAt),
    },
  });
  await tx.session.update({ where: { id: s.id }, data: { packageApplied: true } });
}

/** Reverse `applyPackageHours` when a session stops being billable. */
export async function revertPackageHours(tx: Tx, sessionId: string): Promise<void> {
  const s = await tx.session.findUnique({
    where: { id: sessionId },
    select: { id: true, packageId: true, hours: true, packageApplied: true },
  });
  if (!s || !s.packageId || !s.packageApplied) return;

  const pkg = await tx.package.findUnique({ where: { id: s.packageId } });
  if (!pkg) return;

  const used = Math.max(0, toNumber(pkg.hoursUsed) - toNumber(s.hours));
  await tx.package.update({
    where: { id: pkg.id },
    data: {
      hoursUsed: used,
      status: packageStatusFor(toNumber(pkg.totalHours), used, pkg.expiresAt),
    },
  });
  await tx.session.update({ where: { id: s.id }, data: { packageApplied: false } });
}

/* ------------------------------- allocations -------------------------------- */

/** Recompute one session's paymentStatus from its allocations. */
export async function syncSessionPaymentStatus(tx: Tx, sessionId: string): Promise<void> {
  const session = await tx.session.findUnique({
    where: { id: sessionId },
    select: { id: true, total: true, packageId: true, status: true },
  });
  if (!session) return;

  // A no-show the centre does not charge for owes nothing, so it is settled the
  // same way a package-covered session is: there is no payment to wait for.
  // Leaving it UNPAID would put a debt on the parent's statement for a lesson
  // the centre has decided not to bill, and chasing that is worse than the bug.
  if (session.status === "NO_SHOW" && !noShowIsChargeable(await noShowPolicy())) {
    await tx.session.update({ where: { id: sessionId }, data: { paymentStatus: "PAID" } });
    return;
  }

  // Package-covered sessions are paid for by the package purchase, not per session.
  if (session.packageId) {
    await tx.session.update({ where: { id: sessionId }, data: { paymentStatus: "PAID" } });
    return;
  }

  const agg = await tx.paymentAllocation.aggregate({
    _sum: { amount: true },
    where: { sessionId },
  });
  await tx.session.update({
    where: { id: sessionId },
    data: {
      paymentStatus: paymentStatusFor(toNumber(session.total), toNumber(agg._sum.amount)),
    },
  });
}

/** Sessions still owing money for a student, oldest first (for allocation UI). */
export async function outstandingSessions(studentId: string) {
  const sessions = await db.session.findMany({
    where: {
      studentId,
      packageId: null, // package-covered sessions aren't separately payable
      status: { notIn: await unchargeableStatuses() },
    },
    orderBy: { date: "asc" },
    include: { allocations: true, teacher: true },
  });
  return sessions
    .map((s) => {
      const allocated = s.allocations.reduce((sum, a) => sum + toNumber(a.amount), 0);
      const total = toNumber(s.total);
      return {
        id: s.id,
        date: s.date.toISOString().slice(0, 10),
        teacherName: s.teacher?.name ?? "",
        total,
        allocated,
        outstanding: Math.max(0, total - allocated),
      };
    })
    .filter((s) => s.outstanding > 0.005);
}
