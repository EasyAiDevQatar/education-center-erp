import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { moduleEnabled } from "@/lib/modules";
import { FINANCE_ROLES } from "@/lib/rbac";
import { getSession } from "@/lib/session";
import {
  BUDGET_IMPORT_HEADERS,
  BUDGET_IMPORT_HEADERS_AR,
  buildBudgetSampleRows,
} from "@/lib/budget-import";

export const runtime = "nodejs";

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

/** Download a category-aware workbook that can be edited and imported back. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !FINANCE_ROLES.includes(session.role)) return errorResponse("forbidden", 403);
  if (!(await moduleEnabled("budget"))) return errorResponse("moduleDisabled", 403);

  const url = new URL(request.url);
  const planId = String(url.searchParams.get("planId") ?? "").trim();
  const locale = url.searchParams.get("locale") === "ar" ? "ar" : "en";
  if (!planId || planId.length > 100) return errorResponse("notfound", 404);

  const [plan, categories] = await Promise.all([
    db.budgetPlan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        status: true,
        items: {
          select: {
            month: true,
            key: true,
            amount: true,
            behavior: true,
            notes: true,
          },
        },
      },
    }),
    db.expenseCategory.findMany({
      select: { id: true, nameAr: true, nameEn: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
    }),
  ]);
  if (!plan) return errorResponse("notfound", 404);
  if (plan.status === "ARCHIVED") return errorResponse("archived", 409);
  if (categories.length > 250) return errorResponse("tooManyCategories", 409);

  const isArabic = locale === "ar";
  const values = {
    income: isArabic ? "دخل" : "INCOME",
    expense: isArabic ? "مصروف" : "EXPENSE",
    fixed: isArabic ? "ثابت" : "FIXED",
    variable: isArabic ? "متغير" : "VARIABLE",
  };

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Education Center ERP";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Budget", {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: isArabic }],
  });
  sheet.columns = (isArabic ? BUDGET_IMPORT_HEADERS_AR : BUDGET_IMPORT_HEADERS).map(
    (header, index) => ({
      header,
      key: BUDGET_IMPORT_HEADERS[index].toLocaleLowerCase("en-US"),
      width: [14, 14, 30, 16, 16, 36][index],
    }),
  );

  const sampleRows = buildBudgetSampleRows(plan, categories, plan.items, locale);
  for (const row of sampleRows.slice(1)) sheet.addRow(row);

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F7185" } };
  header.alignment = { vertical: "middle", horizontal: "center" };
  header.height = 24;
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: BUDGET_IMPORT_HEADERS.length },
  };
  sheet.getColumn(1).numFmt = "@";
  sheet.getColumn(4).numFmt = "#,##0.00";
  if (sheet.rowCount > 1) {
    for (let row = 2; row <= sheet.rowCount; row += 1) {
      sheet.getCell(row, 2).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: [`"${values.income},${values.expense}"`],
      };
      sheet.getCell(row, 5).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [
          sheet.getCell(row, 2).value === values.income
            ? `"${values.fixed}"`
            : `"${values.fixed},${values.variable}"`,
        ],
      };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="budget-import-${plan.startDate.toISOString().slice(0, 10)}.xlsx"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
