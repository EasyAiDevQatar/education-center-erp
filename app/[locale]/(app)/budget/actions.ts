"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { getSession } from "@/lib/session";
import { FINANCE_ROLES } from "@/lib/rbac";

export type BudgetActionState = { ok?: boolean; error?: string; id?: string };

const MAX_AMOUNT = 1_000_000_000;
const money = z.coerce.number().finite().min(0).max(MAX_AMOUNT);
const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const planSchema = z.object({
  name: z.string().trim().min(2).max(120),
  startDate: z.string().date(),
  endDate: z.string().date(),
  includePayrollActual: z.boolean(),
  notes: z.string().trim().max(1000).nullable(),
});

const monthlySchema = z.object({
  planId: z.string().min(1),
  month: monthKey,
  plannedIncome: money,
  expenses: z
    .array(
      z.object({
        categoryId: z.string().min(1),
        amount: money,
        behavior: z.enum(["FIXED", "VARIABLE"]),
      }),
    )
    .max(250),
});

async function financeSession() {
  const session = await getSession();
  return session && FINANCE_ROLES.includes(session.role) ? session : null;
}

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function monthDate(value: string): Date {
  return new Date(`${value}-01T00:00:00.000Z`);
}

function monthInsidePlan(month: Date, plan: { startDate: Date; endDate: Date }): boolean {
  const monthEnd = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return month <= plan.endDate && monthEnd >= plan.startDate;
}

function nullableText(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

export async function saveBudgetPlan(
  locale: string,
  id: string | null,
  _previous: BudgetActionState,
  formData: FormData,
): Promise<BudgetActionState> {
  const session = await financeSession();
  if (!session) return { error: "forbidden" };

  const parsed = planSchema.safeParse({
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    includePayrollActual: formData.get("includePayrollActual") === "on",
    notes: nullableText(formData.get("notes")),
  });
  if (!parsed.success) return { error: "invalid" };

  const startDate = dateOnly(parsed.data.startDate);
  const endDate = new Date(`${parsed.data.endDate}T23:59:59.999Z`);
  if (startDate > endDate) return { error: "invalidPeriod" };
  const latestAllowed = new Date(Date.UTC(startDate.getUTCFullYear() + 3, startDate.getUTCMonth(), startDate.getUTCDate()));
  if (endDate > latestAllowed) return { error: "periodTooLong" };

  const data = {
    name: parsed.data.name,
    startDate,
    endDate,
    includePayrollActual: parsed.data.includePayrollActual,
    notes: parsed.data.notes,
  };

  if (id) {
    const existing = await db.budgetPlan.findUnique({ where: { id } });
    if (!existing) return { error: "notfound" };
    if (existing.status === "ARCHIVED") return { error: "archived" };
    const firstMonth = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
    const monthAfterEnd = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 1));
    const outsideItems = await db.budgetItem.count({
      where: {
        planId: id,
        OR: [{ month: { lt: firstMonth } }, { month: { gte: monthAfterEnd } }],
      },
    });
    if (outsideItems > 0) return { error: "itemsOutsidePeriod" };
    await db.budgetPlan.update({ where: { id }, data });
    await writeAudit("BudgetPlan", id, "UPDATE", { before: existing, after: data });
  } else {
    const created = await db.budgetPlan.create({
      data: { ...data, status: "ACTIVE", createdById: session.userId },
    });
    id = created.id;
    await writeAudit("BudgetPlan", created.id, "CREATE", { after: data });
  }

  revalidatePath(`/${locale}/budget`);
  return { ok: true, id };
}

export async function saveBudgetMonth(
  locale: string,
  input: z.infer<typeof monthlySchema>,
): Promise<BudgetActionState> {
  if (!(await financeSession())) return { error: "forbidden" };
  const parsed = monthlySchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };

  const { planId, month, plannedIncome } = parsed.data;
  const plan = await db.budgetPlan.findUnique({ where: { id: planId } });
  if (!plan) return { error: "notfound" };
  if (plan.status === "ARCHIVED") return { error: "archived" };
  const at = monthDate(month);
  if (!monthInsidePlan(at, plan)) return { error: "outsidePeriod" };

  const byCategory = new Map(parsed.data.expenses.map((row) => [row.categoryId, row]));
  if (byCategory.size !== parsed.data.expenses.length) return { error: "duplicateCategory" };
  const categories = await db.expenseCategory.findMany({
    where: { id: { in: [...byCategory.keys()] } },
    select: { id: true, nameAr: true, nameEn: true },
  });
  if (categories.length !== byCategory.size) return { error: "invalidCategory" };

  await db.$transaction(async (tx) => {
    await tx.budgetItem.deleteMany({ where: { planId, month: at } });
    await tx.budgetItem.create({
      data: {
        planId,
        month: at,
        key: "INCOME",
        kind: "INCOME",
        label: "Expected income / الدخل المتوقع",
        amount: plannedIncome,
        behavior: "FIXED",
      },
    });
    if (categories.length) {
      await tx.budgetItem.createMany({
        data: categories.map((category) => {
          const row = byCategory.get(category.id)!;
          return {
            planId,
            month: at,
            key: category.id,
            kind: "EXPENSE",
            expenseCategoryId: category.id,
            label: `${category.nameEn} / ${category.nameAr}`,
            amount: row.amount,
            behavior: row.behavior,
          };
        }),
      });
    }
    await tx.budgetPlan.update({ where: { id: planId }, data: { updatedAt: new Date() } });
  });

  await writeAudit("BudgetPlan", planId, "UPDATE", {
    after: { month, plannedIncome, expenseCategories: categories.length },
  });
  revalidatePath(`/${locale}/budget`);
  return { ok: true };
}

export async function copyBudgetMonth(
  locale: string,
  input: { planId: string; sourceMonth: string; targetMonth: string },
): Promise<BudgetActionState> {
  if (!(await financeSession())) return { error: "forbidden" };
  const parsed = z
    .object({ planId: z.string().min(1), sourceMonth: monthKey, targetMonth: monthKey })
    .safeParse(input);
  if (!parsed.success || parsed.data.sourceMonth === parsed.data.targetMonth) return { error: "invalid" };

  const plan = await db.budgetPlan.findUnique({ where: { id: parsed.data.planId } });
  if (!plan) return { error: "notfound" };
  if (plan.status === "ARCHIVED") return { error: "archived" };
  const source = monthDate(parsed.data.sourceMonth);
  const target = monthDate(parsed.data.targetMonth);
  if (!monthInsidePlan(source, plan) || !monthInsidePlan(target, plan)) return { error: "outsidePeriod" };

  const items = await db.budgetItem.findMany({ where: { planId: plan.id, month: source } });
  if (!items.length) return { error: "emptySource" };
  await db.$transaction(async (tx) => {
    await tx.budgetItem.deleteMany({ where: { planId: plan.id, month: target } });
    await tx.budgetItem.createMany({
      data: items.map((item) => ({
        planId: plan.id,
        month: target,
        key: item.key,
        kind: item.kind,
        expenseCategoryId: item.expenseCategoryId,
        label: item.label,
        amount: item.amount,
        behavior: item.behavior,
        notes: item.notes,
      })),
    });
    await tx.budgetPlan.update({ where: { id: plan.id }, data: { updatedAt: new Date() } });
  });
  await writeAudit("BudgetPlan", plan.id, "UPDATE", {
    after: { copiedFrom: parsed.data.sourceMonth, copiedTo: parsed.data.targetMonth },
  });
  revalidatePath(`/${locale}/budget`);
  return { ok: true };
}

export async function archiveBudgetPlan(locale: string, id: string): Promise<BudgetActionState> {
  if (!(await financeSession())) return { error: "forbidden" };
  const plan = await db.budgetPlan.findUnique({ where: { id } });
  if (!plan) return { error: "notfound" };
  if (plan.status === "ARCHIVED") return { ok: true };
  await db.budgetPlan.update({ where: { id }, data: { status: "ARCHIVED" } });
  await writeAudit("BudgetPlan", id, "UPDATE", { after: { status: "ARCHIVED" } });
  revalidatePath(`/${locale}/budget`);
  return { ok: true };
}
