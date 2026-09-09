import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

const mocks = vi.hoisted(() => {
  const tx = {
    budgetPlan: { findUnique: vi.fn(), update: vi.fn() },
    expenseCategory: { findMany: vi.fn() },
    budgetItem: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    getSession: vi.fn(),
    moduleEnabled: vi.fn(),
    findPlan: vi.fn(),
    findCategories: vi.fn(),
    transaction: vi.fn(),
    tx,
  };
});

vi.mock("@/lib/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/modules", () => ({ moduleEnabled: mocks.moduleEnabled }));
vi.mock("@/lib/rbac", () => ({ FINANCE_ROLES: ["ADMIN", "ACCOUNTANT"] }));
vi.mock("@/lib/db", () => ({
  db: {
    budgetPlan: { findUnique: mocks.findPlan },
    expenseCategory: { findMany: mocks.findCategories },
    $transaction: mocks.transaction,
  },
}));

import { POST } from "@/app/api/budget/import/route";
import { GET } from "@/app/api/budget/sample/route";
import {
  BUDGET_IMPORT_HEADERS,
  readBudgetSpreadsheet,
  validateBudgetImportRows,
} from "@/lib/budget-import";

const plan = {
  id: "plan-1",
  name: "2026",
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  endDate: new Date("2026-01-31T23:59:59.999Z"),
  status: "ACTIVE",
  items: [
    { month: new Date("2026-01-01T00:00:00.000Z"), key: "INCOME", amount: 500, behavior: "FIXED", notes: null },
    { month: new Date("2026-01-01T00:00:00.000Z"), key: "inactive", amount: 40, behavior: "VARIABLE", notes: "Keep" },
  ],
};
const categories = [
  { id: "rent", nameAr: "الإيجار", nameEn: "Rent", sortOrder: 1 },
  { id: "inactive", nameAr: "قديمة", nameEn: "Inactive", sortOrder: 2 },
];

function workbookFile(rows: unknown[][], extension: "xls" | "xlsx" = "xlsx") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Budget");
  const bytes = XLSX.write(workbook, {
    bookType: extension === "xls" ? "biff8" : "xlsx",
    type: "array",
  });
  return new File([bytes], `budget.${extension}`, {
    type: extension === "xls"
      ? "application/vnd.ms-excel"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function importRequest(rows: unknown[][]) {
  const form = new FormData();
  form.set("planId", plan.id);
  form.set("file", workbookFile(rows));
  return new Request("https://education.example/api/budget/import", {
    method: "POST",
    body: form,
    headers: { origin: "https://education.example", host: "education.example" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ userId: "admin-1", role: "ADMIN" });
  mocks.moduleEnabled.mockResolvedValue(true);
  mocks.findPlan.mockResolvedValue(plan);
  mocks.findCategories.mockResolvedValue(categories);
  mocks.tx.budgetPlan.findUnique.mockResolvedValue(plan);
  mocks.tx.expenseCategory.findMany.mockResolvedValue(categories);
  mocks.tx.budgetItem.findMany.mockResolvedValue([
    { id: "old-income", key: "INCOME", kind: "INCOME", expenseCategoryId: null, amount: 500 },
    { id: "orphan", key: "deleted-category", kind: "EXPENSE", expenseCategoryId: null, amount: 75 },
  ]);
  mocks.transaction.mockImplementation(async (callback: (transaction: typeof mocks.tx) => unknown) => callback(mocks.tx));
});

describe("budget import route", () => {
  it("rejects unauthenticated and disabled-module requests before parsing", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const unauthorized = await POST(importRequest([[...BUDGET_IMPORT_HEADERS]]));
    expect(unauthorized.status).toBe(403);
    expect(mocks.findPlan).not.toHaveBeenCalled();

    mocks.getSession.mockResolvedValueOnce({ userId: "admin-1", role: "ADMIN" });
    mocks.moduleEnabled.mockResolvedValueOnce(false);
    const disabled = await POST(importRequest([[...BUDGET_IMPORT_HEADERS]]));
    expect(disabled.status).toBe(403);
    expect(await disabled.json()).toEqual({ error: "moduleDisabled" });
    expect(mocks.findPlan).not.toHaveBeenCalled();
  });

  it("validates every row before beginning the transaction", async () => {
    const response = await POST(importRequest([
      [...BUDGET_IMPORT_HEADERS],
      ["2026-01", "INCOME", "", 100, "", ""],
      ["2026-01", "INCOME", "", 200, "", ""],
    ]));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalidRows" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("atomically replaces only imported months, records audit, and preserves orphan rows", async () => {
    const response = await POST(importRequest([
      [...BUDGET_IMPORT_HEADERS],
      ["2026-01", "INCOME", "", 1_000, "", ""],
      ["2026-01", "EXPENSE", "Rent", 100, "FIXED", ""],
    ]));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, imported: 2, months: 1 });
    expect(mocks.tx.budgetItem.deleteMany).toHaveBeenCalledWith({
      where: {
        planId: plan.id,
        month: { in: [new Date("2026-01-01T00:00:00.000Z")] },
        id: { notIn: ["orphan"] },
      },
    });
    expect(mocks.tx.budgetItem.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ month: new Date("2026-01-01T00:00:00.000Z"), key: "INCOME", amount: 1_000 }),
        expect.objectContaining({ month: new Date("2026-01-01T00:00:00.000Z"), key: "rent", amount: 100 }),
      ]),
    });
    const audit = mocks.tx.auditLog.create.mock.calls[0][0].data;
    expect(JSON.parse(audit.after)).toMatchObject({
      source: "SPREADSHEET_IMPORT",
      items: 3,
      preservedOrphanItems: 1,
      plannedIncome: 1_000,
      plannedExpenses: 175,
    });
  });
});

describe("budget sample route", () => {
  it("is gated and produces a category-aware workbook that imports without loss", async () => {
    const response = await GET(new Request(
      `https://education.example/api/budget/sample?planId=${plan.id}&locale=en`,
    ));

    expect(response.status).toBe(200);
    const rows = readBudgetSpreadsheet(new Uint8Array(await response.arrayBuffer()));
    const validation = validateBudgetImportRows(rows, categories, plan);
    expect(validation).toMatchObject({ ok: true, months: ["2026-01"] });
    if (!validation.ok) throw new Error("expected generated sample to round-trip");
    expect(validation.items).toContainEqual(
      expect.objectContaining({ key: "inactive", amount: 40, behavior: "VARIABLE", notes: "Keep" }),
    );
  });
});
