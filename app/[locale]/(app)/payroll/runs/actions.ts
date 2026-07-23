"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { FINANCE_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { toNumber } from "@/lib/money";
import { guardArchived } from "@/lib/academic-year";
import { monthRange } from "@/lib/payroll-period";
import { getTeacherEarnings } from "@/lib/payroll";
import { computePay, resolveEarningsMode } from "@/lib/earnings-mode";
import { resolveSalary } from "@/lib/salary-source";
import { leaveDays } from "@/lib/leave";
import { PAYSLIP_METHODS } from "@/lib/enums";
import { accountingEnabled, postSource } from "@/lib/accounting/journal-data";
import { linesForPayslip } from "@/lib/accounting/posting";

export type RunState = { ok?: boolean; error?: string; count?: number; runId?: string };

/** Salary months are 30 days by convention — the same convention gratuity and
    the WPS working-days column use. */
const SALARY_MONTH_DAYS = 30;

async function guard() {
  const s = await getSession();
  return !s || !FINANCE_ROLES.includes(s.role);
}

const schema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  employeeIds: z.array(z.string().min(1)).min(1).max(200),
  paymentMethod: z.enum(PAYSLIP_METHODS).default("BANK"),
  notes: z.string().trim().optional().nullable(),
  /** Set when the user has seen the duplicate-month warning and insists. */
  force: z.boolean().default(false),
});

/**
 * Generate one payslip per selected employee, in one batch.
 *
 * A teacher-employee gets ONE row carrying both links: commission via the
 * teacher, salary via the employee. The @@unique([employeeId, runId]) index
 * makes a double-clicked generate a skip, not a double payment.
 */
export async function createPayrollRun(
  locale: string,
  input: {
    month: string;
    employeeIds: string[];
    paymentMethod: string;
    notes?: string | null;
    force?: boolean;
  },
): Promise<RunState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const { from, to } = monthRange(d.month);
  const periodStart = new Date(`${from}T00:00:00.000Z`);
  const periodEnd = new Date(`${to}T23:59:59.999Z`);

  // An archived academic year is immutable — payroll included.
  const archived = await guardArchived(periodStart, periodEnd);
  if (archived) return { error: archived };

  // Off-cycle and corrective runs are legitimate, so a second run for the same
  // month is a warning the user must acknowledge, not a hard stop.
  if (!d.force) {
    const existing = await db.payrollRun.count({ where: { month: d.month } });
    if (existing > 0) return { error: "monthHasRun" };
  }

  const s = await getSession();
  const employees = await db.employee.findMany({
    where: { id: { in: d.employeeIds }, status: { not: "TERMINATED" } },
    include: { teacher: true },
  });
  if (employees.length === 0) return { error: "noSelection" };

  const centreEarn = await db.setting.findUnique({ where: { key: "teacherEarningsMode" } });

  // Approved unpaid leave inside the month reduces both pay and the WPS
  // working-days column.
  const unpaidLeave = await db.leaveRequest.findMany({
    where: {
      employeeId: { in: employees.map((e) => e.id) },
      typeCode: "UNPAID",
      status: "APPROVED",
      startDate: { lte: periodEnd },
      endDate: { gte: periodStart },
    },
  });

  const run = await db.payrollRun.create({
    data: {
      month: d.month,
      periodStart,
      periodEnd,
      paymentMethod: d.paymentMethod,
      notes: d.notes ?? null,
      createdByUserId: s?.userId ?? null,
    },
  });

  let count = 0;
  for (const e of employees) {
    // Unpaid days clamped to this month.
    const unpaidDays = unpaidLeave
      .filter((r) => r.employeeId === e.id)
      .reduce((n, r) => {
        const start = r.startDate < periodStart ? from : r.startDate.toISOString().slice(0, 10);
        const end = r.endDate > periodEnd ? to : r.endDate.toISOString().slice(0, 10);
        return n + leaveDays(start, end);
      }, 0);

    const salary = resolveSalary({
      employee: { basicSalary: toNumber(e.basicSalary), allowances: toNumber(e.allowances) },
      teacher: e.teacher ? { fixedSalary: toNumber(e.teacher.fixedSalary) } : null,
    });

    // Unpaid leave docks pay at the daily rate of the FULL package — the
    // employee loses the whole day, not just its basic portion.
    const unpaidDeduction =
      unpaidDays > 0 ? (salary.total / SALARY_MONTH_DAYS) * unpaidDays : 0;
    const standingDeductions = e.teacher ? toNumber(e.teacher.fixedDeductions) : 0;

    // Commission only flows through a linked teacher, on what was collected.
    let commission = 0;
    let earnMode: ReturnType<typeof resolveEarningsMode> = "SALARY";
    if (e.teacher) {
      const earnings = await getTeacherEarnings(e.teacher.id, periodStart, periodEnd);
      commission = earnings?.dueCommission ?? 0;
      earnMode = resolveEarningsMode(e.teacher.earningsMode, centreEarn?.value ?? null);
    }

    const pay = computePay(earnMode, {
      commission,
      salary: salary.total,
      deductions: unpaidDeduction + standingDeductions,
      advances: 0,
    });

    try {
      await db.teacherPayout.create({
        data: {
          teacherId: e.teacherId,
          employeeId: e.id,
          runId: run.id,
          periodStart,
          periodEnd,
          grossCommission: pay.commission,
          expectedCommission: 0,
          // fixedSalary stays the sum so every pre-HR reader stays correct.
          fixedSalary: pay.salary,
          basicSalary: earnMode === "COMMISSION" ? 0 : salary.basic,
          allowances: earnMode === "COMMISSION" ? 0 : salary.allowances,
          deductions: pay.deductions,
          advances: 0,
          netPaid: pay.net,
          workingDays: Math.max(0, SALARY_MONTH_DAYS - unpaidDays),
          unpaidLeaveDays: unpaidDays,
          paymentMethod: d.paymentMethod,
          payMode: "MONTH",
          earnMode,
        },
      });
      count += 1;
    } catch (err) {
      // The unique index: this employee is already on this run. Skip, never
      // double-pay.
      if ((err as { code?: string }).code !== "P2002") throw err;
    }
  }

  await writeAudit("PayrollRun", run.id, "CREATE", {
    after: { month: d.month, employees: count, method: d.paymentMethod },
  });
  revalidatePath(`/${locale}/payroll/runs`);
  return { ok: true, count, runId: run.id };
}

/** Settle the whole run: run and every draft payslip on it become PAID. */
export async function markRunPaid(locale: string, runId: string): Promise<RunState> {
  if (await guard()) return { error: "forbidden" };
  const run = await db.payrollRun.findUnique({ where: { id: runId } });
  if (!run) return { error: "notfound" };
  if (run.status === "PAID") return { error: "alreadyDecided" };

  const now = new Date();
  const posting = await accountingEnabled();
  let count = 0;
  await db.$transaction(async (tx) => {
    const res = await tx.teacherPayout.updateMany({
      where: { runId, status: "DRAFT" },
      data: { status: "PAID", paidAt: now },
    });
    count = res.count;
    await tx.payrollRun.update({ where: { id: runId }, data: { status: "PAID", paidAt: now } });
    if (posting) {
      // One journal entry per payslip, keyed on the payout id — a re-run (or
      // a payslip already paid individually) is a P2002 skip inside postSource.
      const slips = await tx.teacherPayout.findMany({
        where: { runId },
        include: { teacher: { select: { name: true } }, employee: { select: { name: true } } },
      });
      for (const p of slips) {
        await postSource(tx, {
          date: now,
          memo: `راتب — ${p.teacher?.name ?? p.employee?.name ?? p.id}`,
          sourceType: "PAYROLL",
          sourceId: p.id,
          lines: linesForPayslip({ net: toNumber(p.netPaid), method: p.paymentMethod }),
        });
      }
    }
  });
  await writeAudit("PayrollRun", runId, "UPDATE", {
    after: { status: "PAID", items: count },
  });
  revalidatePath(`/${locale}/payroll/runs`);
  revalidatePath(`/${locale}/payroll/runs/${runId}`);
  return { ok: true, count };
}

/**
 * A draft run can be discarded; a paid one is history. Items are deleted
 * explicitly — the FK is SET NULL, and orphaning them would leave ghost
 * payslips floating outside any run.
 */
export async function deleteRun(locale: string, runId: string): Promise<RunState> {
  if (await guard()) return { error: "forbidden" };
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { items: { select: { status: true } } },
  });
  if (!run) return { error: "notfound" };
  if (run.status === "PAID" || run.items.some((i) => i.status === "PAID")) {
    return { error: "runPaid" };
  }
  await db.$transaction([
    db.teacherPayout.deleteMany({ where: { runId } }),
    db.payrollRun.delete({ where: { id: runId } }),
  ]);
  await writeAudit("PayrollRun", runId, "DELETE");
  revalidatePath(`/${locale}/payroll/runs`);
  return { ok: true };
}
