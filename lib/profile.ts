import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { toNumber } from "./money";
import type { SessionLine, PaymentLine, PayoutLine } from "@/components/tables/relation-tables";

/** Shared loaders for the 360° profile pages (student / teacher / guardian). */

export async function loadSessionLines(
  where: Prisma.SessionWhereInput,
  locale: string,
  take = 500,
): Promise<SessionLine[]> {
  const rows = await db.session.findMany({
    where,
    orderBy: { date: "desc" },
    take,
    include: { student: true, teacher: true, gradeLevel: true },
  });
  return rows.map((s) => ({
    id: s.id,
    date: s.date.toISOString().slice(0, 10),
    time: s.date.toISOString().slice(11, 16),
    studentName: s.student.name,
    teacherName: s.teacher?.name ?? "",
    levelLabel: locale === "ar" ? s.gradeLevel.nameAr : s.gradeLevel.nameEn,
    location: s.location,
    hours: toNumber(s.hours),
    total: toNumber(s.total),
    status: s.status,
    paymentStatus: s.paymentStatus,
  }));
}

export async function loadPaymentLines(
  where: Prisma.PaymentWhereInput,
  take = 500,
): Promise<PaymentLine[]> {
  const rows = await db.payment.findMany({
    where,
    orderBy: { date: "desc" },
    take,
    include: { student: true, teacher: true },
  });
  return rows.map((p) => ({
    id: p.id,
    date: p.date.toISOString().slice(0, 10),
    receiptNo: p.receiptNo,
    studentName: p.student?.name ?? "—",
    amount: toNumber(p.amount),
    method: p.method,
    teacherName: p.teacher?.name ?? null,
  }));
}

/**
 * A teacher's collection history follows session allocations, not the
 * receipt's one-teacher compatibility field. Mixed receipts therefore appear
 * once for each teacher with only that teacher's allocated amount.
 */
export async function loadTeacherPaymentLines(
  teacherId: string,
  take = 500,
): Promise<PaymentLine[]> {
  const [allocated, direct] = await Promise.all([
    db.paymentAllocation.findMany({
      where: { session: { teacherId }, payment: { status: "COMPLETED" } },
      orderBy: { payment: { date: "desc" } },
      take,
      include: { payment: { include: { student: true } }, session: { include: { teacher: true } } },
    }),
    db.payment.findMany({
      where: { teacherId, status: "COMPLETED", allocations: { none: {} } },
      orderBy: { date: "desc" },
      take,
      include: { student: true, teacher: true },
    }),
  ]);

  const allocatedByPayment = new Map<string, PaymentLine>();
  for (const row of allocated) {
    const current = allocatedByPayment.get(row.paymentId) ?? {
      id: row.paymentId,
      date: row.payment.date.toISOString().slice(0, 10),
      receiptNo: row.payment.receiptNo,
      studentName: row.payment.student?.name ?? "—",
      amount: 0,
      method: row.payment.method,
      teacherName: row.session.teacher?.name ?? null,
    };
    current.amount += toNumber(row.amount);
    allocatedByPayment.set(row.paymentId, current);
  }

  return [
    ...allocatedByPayment.values(),
    ...direct.map((payment) => ({
      id: payment.id,
      date: payment.date.toISOString().slice(0, 10),
      receiptNo: payment.receiptNo,
      studentName: payment.student?.name ?? "—",
      amount: toNumber(payment.amount),
      method: payment.method,
      teacherName: payment.teacher?.name ?? null,
    })),
  ]
    .sort((a, b) => b.date.localeCompare(a.date) || b.receiptNo.localeCompare(a.receiptNo))
    .slice(0, take);
}

export async function loadPayoutLines(teacherId: string): Promise<PayoutLine[]> {
  const rows = await db.teacherPayout.findMany({
    where: { teacherId },
    orderBy: { periodStart: "desc" },
  });
  return rows.map((p) => ({
    id: p.id,
    periodStart: p.periodStart.toISOString().slice(0, 10),
    periodEnd: p.periodEnd.toISOString().slice(0, 10),
    grossCommission: toNumber(p.grossCommission),
    fixedSalary: toNumber(p.fixedSalary),
    deductions: toNumber(p.deductions),
    advances: toNumber(p.advances),
    netPaid: toNumber(p.netPaid),
    status: p.status,
  }));
}

/** Currency label from settings, defaulting to QAR. */
export async function getCurrency(): Promise<string> {
  const row = await db.setting.findUnique({ where: { key: "currency" } });
  return row?.value ?? "QAR";
}
