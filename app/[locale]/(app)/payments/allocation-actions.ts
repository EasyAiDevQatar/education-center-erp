"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { toNumber } from "@/lib/money";
import { displayName } from "@/lib/names";
import { suggestAllocation, type PayableSession } from "@/lib/allocation";

export type OutstandingResult = {
  sessions: PayableSession[];
  /** Sum still owed across the listed sessions. */
  totalOutstanding: number;
};

async function guard() {
  const s = await getSession();
  return !s || !STAFF_ROLES.includes(s.role);
}

/**
 * What this student still owes, oldest first.
 *
 * Package-covered sessions are excluded: they were paid for when the package
 * was bought, so letting a payment land on one would collect twice. DRAFT and
 * CANCELLED are excluded for the same reason they are everywhere else — an
 * unconfirmed lesson is not yet a debt.
 */
export async function loadOutstandingSessions(
  locale: string,
  studentId: string,
): Promise<OutstandingResult> {
  if (await guard()) return { sessions: [], totalOutstanding: 0 };
  if (!studentId) return { sessions: [], totalOutstanding: 0 };

  const rows = await db.session.findMany({
    where: {
      studentId,
      packageId: null,
      status: { notIn: ["DRAFT", "CANCELLED"] },
    },
    orderBy: { date: "asc" },
    include: { allocations: true, teacher: true, subject: true },
  });

  const sessions: PayableSession[] = rows
    .map((s) => {
      const allocated = s.allocations.reduce((sum, a) => sum + toNumber(a.amount), 0);
      const total = toNumber(s.total);
      return {
        id: s.id,
        date: s.date.toISOString().slice(0, 10),
        teacherId: s.teacherId,
        teacherName: s.teacher ? displayName(s.teacher, locale) : "",
        total,
        allocated,
        outstanding: Math.round(Math.max(0, total - allocated) * 100) / 100,
      };
    })
    .filter((s) => s.outstanding > 0.005);

  return {
    sessions,
    totalOutstanding:
      Math.round(sessions.reduce((a, s) => a + s.outstanding, 0) * 100) / 100,
  };
}

/** The suggestion for an amount, computed server-side so both dialogs agree. */
export async function suggestForAmount(
  locale: string,
  studentId: string,
  amount: number,
) {
  const { sessions, totalOutstanding } = await loadOutstandingSessions(locale, studentId);
  return { sessions, totalOutstanding, suggestion: suggestAllocation(sessions, amount) };
}