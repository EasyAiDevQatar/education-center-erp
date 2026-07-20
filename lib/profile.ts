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
    teacherName: s.teacher.name,
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
