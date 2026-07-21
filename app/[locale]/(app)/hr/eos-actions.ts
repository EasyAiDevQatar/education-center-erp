"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { HR_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { toNumber } from "@/lib/money";
import {
  computeGratuity,
  computeSettlement,
  dailyBasic,
} from "@/lib/gratuity";

export type EosState = { ok?: boolean; error?: string };

async function guard() {
  const s = await getSession();
  return !s || !HR_ROLES.includes(s.role);
}

const schema = z.object({
  employeeId: z.string().min(1),
  lastWorkingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  unusedLeaveDays: z.coerce.number().min(0).max(365).default(0),
  otherDues: z.coerce.number().min(0).default(0),
  deductions: z.coerce.number().min(0).default(0),
  notes: z.string().trim().optional().nullable(),
});

/**
 * Final end-of-service settlement.
 *
 * The server recomputes everything: the client preview cannot know the real
 * unpaid-leave total, and a settlement is the largest single amount the centre
 * will ever owe an employee. All inputs are snapshotted onto the row so a
 * later salary correction cannot rewrite a settlement already paid.
 */
export async function createSettlement(
  locale: string,
  _prev: EosState,
  formData: FormData,
): Promise<EosState> {
  if (await guard()) return { error: "forbidden" };
  const parsed = schema.safeParse({
    employeeId: formData.get("employeeId"),
    lastWorkingDay: formData.get("lastWorkingDay"),
    unusedLeaveDays: formData.get("unusedLeaveDays") || 0,
    otherDues: formData.get("otherDues") || 0,
    deductions: formData.get("deductions") || 0,
    notes: (formData.get("notes") ?? "").toString().trim() || null,
  });
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const employee = await db.employee.findUnique({ where: { id: d.employeeId } });
  if (!employee) return { error: "notfound" };
  if (!employee.hireDate) return { error: "noHireDate" };
  const existing = await db.endOfService.findFirst({
    where: { employeeId: d.employeeId, status: { not: "DRAFT" } },
  });
  if (existing) return { error: "alreadySettled" };

  const hireIso = employee.hireDate.toISOString().slice(0, 10);

  // Approved unpaid leave across the WHOLE employment — this is what can drop
  // someone below the one-year cliff, so it must come from the records, not
  // from a form field.
  const unpaid = await db.leaveRequest.findMany({
    where: { employeeId: d.employeeId, typeCode: "UNPAID", status: "APPROVED" },
  });
  const unpaidDays = unpaid.reduce((n, r) => n + toNumber(r.days), 0);

  const basic = toNumber(employee.basicSalary);
  const g = computeGratuity({
    hireDate: hireIso,
    endDate: d.lastWorkingDay,
    basicSalary: basic,
    unpaidLeaveDays: unpaidDays,
  });
  const s = computeSettlement({
    gratuityAmount: g.amount,
    unusedLeaveDays: d.unusedLeaveDays,
    dailyBasic: dailyBasic(basic),
    otherDues: d.otherDues,
    deductions: d.deductions,
  });

  const session = await getSession();
  const created = await db.$transaction(async (tx) => {
    const row = await tx.endOfService.create({
      data: {
        employeeId: d.employeeId,
        lastWorkingDay: new Date(`${d.lastWorkingDay}T00:00:00.000Z`),
        serviceDays: g.serviceDays,
        serviceYears: g.serviceYears,
        basicSalaryAtEnd: basic,
        unpaidLeaveDays: unpaidDays,
        gratuityDaysPerYear: g.daysPerYear,
        gratuityDays: g.gratuityDays,
        gratuityAmount: g.amount,
        unusedLeaveDays: d.unusedLeaveDays,
        unusedLeaveAmount: s.leaveEncashment,
        otherDues: s.otherDues,
        deductions: s.deductions,
        netSettlement: s.net,
        notes: d.notes,
      },
    });
    // Settlement ends the employment; the register reflects it immediately.
    await tx.employee.update({
      where: { id: d.employeeId },
      data: {
        status: "TERMINATED",
        endDate: new Date(`${d.lastWorkingDay}T00:00:00.000Z`),
      },
    });
    return row;
  });
  void session;

  await writeAudit("EndOfService", created.id, "CREATE", {
    after: { employeeId: d.employeeId, net: s.net, gratuity: g.amount },
  });
  revalidatePath(`/${locale}/hr`);
  return { ok: true };
}
