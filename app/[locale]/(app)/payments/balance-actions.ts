"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { getStudentBalance } from "@/lib/balances";
import { toNumber } from "@/lib/money";

export type OutstandingInfo = {
  balance: number;
  charges: number;
  paid: number;
  /** Unpaid/partial sessions, newest first — what the money is actually for. */
  unpaidSessions: {
    id: string;
    date: string;
    teacherName: string;
    total: number;
    paymentStatus: string;
  }[];
};

/**
 * What a student currently owes, for the payment dialog to pre-fill.
 *
 * Uses `getStudentBalance` so the figure always agrees with the student's
 * statement and the debtors report — three different sums here would be worse
 * than none.
 */
export async function getStudentOutstanding(
  studentId: string,
): Promise<OutstandingInfo | null> {
  const s = await getSession();
  if (!s || !STAFF_ROLES.includes(s.role)) return null;
  if (!studentId) return null;

  const [bal, sessions] = await Promise.all([
    getStudentBalance(studentId),
    db.session.findMany({
      where: {
        studentId,
        status: { not: "DRAFT" },
        packageId: null,
        paymentStatus: { in: ["UNPAID", "PARTIAL"] },
      },
      include: { teacher: { select: { name: true } } },
      orderBy: { date: "desc" },
      take: 50,
    }),
  ]);

  return {
    balance: bal.balance,
    charges: bal.totalCharges,
    paid: bal.totalPaid,
    unpaidSessions: sessions.map((x) => ({
      id: x.id,
      date: x.date.toISOString().slice(0, 10),
      teacherName: x.teacher.name,
      total: toNumber(x.total),
      paymentStatus: x.paymentStatus,
    })),
  };
}
