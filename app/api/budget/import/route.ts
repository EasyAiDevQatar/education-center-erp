import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { moduleEnabled } from "@/lib/modules";
import { FINANCE_ROLES } from "@/lib/rbac";
import { getSession } from "@/lib/session";
import {
  MAX_BUDGET_IMPORT_BYTES,
  isOrphanedBudgetExpense,
  readBudgetSpreadsheet,
  spreadsheetFormat,
  validateBudgetImportRows,
  type BudgetImportIssue,
} from "@/lib/budget-import";

export const runtime = "nodejs";

type BudgetImportResponse = {
  ok?: boolean;
  error?: string;
  imported?: number;
  months?: number;
  issues?: BudgetImportIssue[];
};

function json(body: BudgetImportResponse, status = 200) {
  return NextResponse.json<BudgetImportResponse>(body, { status });
}

function sameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "")
    .split(",", 1)[0]
    .trim();
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function monthDate(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`);
}

function sumByKind(items: { kind: string; amount: number }[], kind: string): number {
  return Math.round(
    items.filter((item) => item.kind === kind).reduce((sum, item) => sum + item.amount, 0) * 100,
  ) / 100;
}

/** Import a complete set of one or more months into the selected budget plan. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || !FINANCE_ROLES.includes(session.role)) return json({ error: "forbidden" }, 403);
  if (!(await moduleEnabled("budget"))) return json({ error: "moduleDisabled" }, 403);
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLocaleLowerCase("en-US").startsWith("multipart/form-data")) {
    return json({ error: "invalidRequest" }, 400);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BUDGET_IMPORT_BYTES + 128 * 1024) {
    return json({ error: "fileTooLarge" }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "invalidRequest" }, 400);
  }
  const planId = String(form.get("planId") ?? "").trim();
  const file = form.get("file");
  if (!planId || planId.length > 100) return json({ error: "notfound" }, 404);
  if (!(file instanceof File) || file.size === 0) return json({ error: "noFile" }, 400);
  if (file.size > MAX_BUDGET_IMPORT_BYTES) return json({ error: "fileTooLarge" }, 413);

  const plan = await db.budgetPlan.findUnique({
    where: { id: planId },
    select: { id: true, startDate: true, endDate: true, status: true },
  });
  if (!plan) return json({ error: "notfound" }, 404);
  if (plan.status === "ARCHIVED") return json({ error: "archived" }, 409);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = spreadsheetFormat(file.name, file.type, bytes);
  if (!format) return json({ error: "unsupportedFileType" }, 415);

  let rows;
  try {
    rows = readBudgetSpreadsheet(bytes);
  } catch (error) {
    if (error instanceof Error && error.message === "formulasNotAllowed") {
      return json({ error: "formulasNotAllowed" }, 400);
    }
    if (error instanceof Error && error.message === "macrosNotAllowed") {
      return json({ error: "macrosNotAllowed" }, 400);
    }
    if (error instanceof Error && error.message === "tooManyRows") {
      return json({ error: "invalidRows", issues: [{ row: 0, code: "tooManyRows" }] }, 400);
    }
    return json({ error: "badFile" }, 400);
  }
  if (rows.length < 2) return json({ error: "emptyFile" }, 400);

  const categories = await db.expenseCategory.findMany({
    select: { id: true, nameAr: true, nameEn: true },
  });
  const validated = validateBudgetImportRows(rows, categories, plan);
  if (!validated.ok) return json({ error: "invalidRows", issues: validated.issues }, 400);

  try {
    await db.$transaction(async (tx) => {
      // Repeat mutable checks inside the transaction so an archived plan or
      // removed category cannot race the validation above.
      const currentPlan = await tx.budgetPlan.findUnique({
        where: { id: plan.id },
        select: { status: true, startDate: true, endDate: true },
      });
      if (!currentPlan) throw new Error("PLAN_NOT_FOUND");
      if (currentPlan.status === "ARCHIVED") throw new Error("PLAN_ARCHIVED");
      const currentCategories = await tx.expenseCategory.findMany({
        select: { id: true, nameAr: true, nameEn: true },
      });
      const currentValidation = validateBudgetImportRows(rows, currentCategories, currentPlan);
      if (!currentValidation.ok) throw new Error("IMPORT_CHANGED");
      const monthDates = currentValidation.months.map(monthDate);

      const before = await tx.budgetItem.findMany({
        where: { planId: plan.id, month: { in: monthDates } },
        select: { id: true, key: true, kind: true, expenseCategoryId: true, amount: true },
      });
      const preservedOrphans = before.filter(isOrphanedBudgetExpense);
      const preservedOrphanIds = preservedOrphans.map((item) => item.id);
      await tx.budgetItem.deleteMany({
        where: {
          planId: plan.id,
          month: { in: monthDates },
          ...(preservedOrphanIds.length ? { id: { notIn: preservedOrphanIds } } : {}),
        },
      });
      const importedItems = currentValidation.items.map((item) => ({
        planId: plan.id,
        month: monthDate(item.month),
        key: item.key,
        kind: item.kind,
        expenseCategoryId: item.expenseCategoryId,
        label: item.label,
        amount: item.amount,
        behavior: item.behavior,
        notes: item.notes,
      }));
      for (let index = 0; index < importedItems.length; index += 500) {
        await tx.budgetItem.createMany({ data: importedItems.slice(index, index + 500) });
      }
      await tx.budgetPlan.update({ where: { id: plan.id }, data: { updatedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          userId: session.userId,
          entity: "BudgetPlan",
          entityId: plan.id,
          action: "UPDATE",
          before: JSON.stringify({
            months: currentValidation.months,
            items: before.length,
            plannedIncome: sumByKind(
              before.map((item) => ({ kind: item.kind, amount: Number(item.amount) })),
              "INCOME",
            ),
            plannedExpenses: sumByKind(
              before.map((item) => ({ kind: item.kind, amount: Number(item.amount) })),
              "EXPENSE",
            ),
          }),
          after: JSON.stringify({
            source: "SPREADSHEET_IMPORT",
            format,
            months: currentValidation.months,
            items: currentValidation.items.length + preservedOrphanIds.length,
            sourceRows: currentValidation.sourceRows,
            preservedOrphanItems: preservedOrphanIds.length,
            plannedIncome: sumByKind(currentValidation.items, "INCOME"),
            plannedExpenses: sumByKind(
              [
                ...currentValidation.items,
                ...preservedOrphans.map((item) => ({ kind: item.kind, amount: Number(item.amount) })),
              ],
              "EXPENSE",
            ),
          }),
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PLAN_NOT_FOUND") {
      return json({ error: "notfound" }, 404);
    }
    if (error instanceof Error && error.message === "PLAN_ARCHIVED") {
      return json({ error: "archived" }, 409);
    }
    if (error instanceof Error && error.message === "IMPORT_CHANGED") {
      return json({ error: "categoryChanged" }, 409);
    }
    return json({ error: "importFailed" }, 500);
  }

  return json({ ok: true, imported: validated.items.length, months: validated.months.length });
}
