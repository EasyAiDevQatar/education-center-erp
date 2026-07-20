import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { toNumber } from "./money";
import { paymentStatusFor, packageStatusFor } from "./billing-rules";

// Re-exported so callers have one billing entry point on the server.
export { paymentStatusFor, packageStatusFor, autoAllocate } from "./billing-rules";

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
    select: { id: true, total: true, packageId: true },
  });
  if (!session) return;

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
      status: { notIn: ["DRAFT", "CANCELLED"] },
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
        teacherName: s.teacher.name,
        total,
        allocated,
        outstanding: Math.max(0, total - allocated),
      };
    })
    .filter((s) => s.outstanding > 0.005);
}
