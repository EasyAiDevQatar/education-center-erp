import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  BUDGET_IMPORT_HEADERS,
  BUDGET_IMPORT_HEADERS_AR,
  MAX_BUDGET_IMPORT_ROWS,
  MAX_BUDGET_XLSX_COMPRESSION_RATIO,
  MAX_BUDGET_XLSX_ENTRIES,
  MAX_BUDGET_XLSX_UNCOMPRESSED_BYTES,
  assertSafeBudgetXlsxArchive,
  buildBudgetSampleRows,
  budgetPlanMonths,
  isOrphanedBudgetExpense,
  readBudgetSpreadsheet,
  spreadsheetFormat,
  uniqueCategoryReference,
  validateBudgetImportRows,
  type BudgetImportCategory,
} from "@/lib/budget-import";

const categories: BudgetImportCategory[] = [
  { id: "rent", nameAr: "الإيجار", nameEn: "Rent" },
  { id: "materials", nameAr: "المواد", nameEn: "Materials" },
];
const plan = {
  startDate: new Date("2026-01-15T00:00:00.000Z"),
  endDate: new Date("2026-03-10T23:59:59.999Z"),
};

function sheetBytes(rows: unknown[][], bookType: "xlsx" | "biff8") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Budget");
  return new Uint8Array(XLSX.write(workbook, { bookType, type: "array" }));
}

type SyntheticZipEntry = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method?: 0 | 8;
  flags?: number;
  extra?: Uint8Array;
};

/** Build only the ZIP structures needed to exercise the bounded preflight. */
function syntheticZip(entries: SyntheticZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const extra = entry.extra ?? new Uint8Array();
    const method = entry.method ?? 8;
    const flags = entry.flags ?? 0;
    const local = new Uint8Array(30 + name.length + extra.length + entry.compressedSize);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, flags, true);
    localView.setUint16(8, method, true);
    localView.setUint32(18, entry.compressedSize, true);
    localView.setUint32(22, entry.uncompressedSize, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, extra.length, true);
    local.set(name, 30);
    local.set(extra, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length + extra.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, flags, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(20, entry.compressedSize, true);
    centralView.setUint32(24, entry.uncompressedSize, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, extra.length, true);
    centralView.setUint32(42, localOffset, true);
    central.set(name, 46);
    central.set(extra, 46 + name.length);
    centralParts.push(central);
    localOffset += local.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(localOffset + centralSize + 22);
  let cursor = 0;
  for (const part of localParts) {
    result.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centralParts) {
    result.set(part, cursor);
    cursor += part.length;
  }
  const endView = new DataView(result.buffer, cursor, 22);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, localOffset, true);
  return result;
}

describe("budget import row validation", () => {
  it("normalizes a valid multi-month English workbook", () => {
    const result = validateBudgetImportRows(
      [
        [...BUDGET_IMPORT_HEADERS],
        ["2026-01", "INCOME", "", 20_000, "", "January target"],
        ["2026-01", "EXPENSE", "Rent", "10,000.50", "FIXED", ""],
        [new Date("2026-02-01T00:00:00.000Z"), "EXPENSE", "المواد", 750, "VARIABLE", "Books"],
        ["2026-02", "INCOME", "", 18_000, "FIXED", ""],
      ],
      categories,
      plan,
    );

    expect(result).toMatchObject({ ok: true, months: ["2026-01", "2026-02"], sourceRows: 4 });
    if (!result.ok) throw new Error("expected valid import");
    expect(result.items).toEqual([
      expect.objectContaining({ month: "2026-01", key: "INCOME", amount: 20_000, behavior: "FIXED" }),
      expect.objectContaining({ month: "2026-01", key: "rent", amount: 10_000.5, behavior: "FIXED" }),
      expect.objectContaining({ month: "2026-02", key: "materials", amount: 750, behavior: "VARIABLE" }),
      expect.objectContaining({ month: "2026-02", key: "INCOME", amount: 18_000, behavior: "FIXED" }),
    ]);
  });

  it("accepts the exact Arabic columns and values", () => {
    const result = validateBudgetImportRows(
      [
        [...BUDGET_IMPORT_HEADERS_AR],
        ["2026/03", "دخل", "", 1_000, "", ""],
        ["2026/03", "مصروف", "الإيجار", 500, "ثابت", ""],
      ],
      categories,
      plan,
    );

    expect(result).toMatchObject({ ok: true, months: ["2026-03"] });
  });

  it.each([
    [["Type", "Month", "Category", "Amount", "Behavior", "Notes"]],
    [[...BUDGET_IMPORT_HEADERS, "Extra"]],
    [["Month", "Type", "Category", "Amount", "Notes"]],
  ])("rejects a changed column layout", (header) => {
    expect(validateBudgetImportRows([header], categories, plan)).toEqual({
      ok: false,
      issues: [{ row: 1, code: "invalidColumns" }],
    });
  });

  it("reports invalid and out-of-plan months without accepting ambiguous dates", () => {
    const result = validateBudgetImportRows(
      [
        [...BUDGET_IMPORT_HEADERS],
        ["01/2026", "INCOME", "", 100, "", ""],
        ["2025-12", "INCOME", "", 100, "", ""],
      ],
      categories,
      plan,
    );

    expect(result).toEqual({
      ok: false,
      issues: [
        { row: 2, code: "invalidMonth", value: "01/2026" },
        { row: 3, code: "outsidePeriod", value: "2025-12" },
      ],
    });
  });

  it("requires exactly one income row and one row per expense category each month", () => {
    const result = validateBudgetImportRows(
      [
        [...BUDGET_IMPORT_HEADERS],
        ["2026-01", "INCOME", "", 100, "", ""],
        ["2026-01", "INCOME", "", 200, "", ""],
        ["2026-01", "EXPENSE", "Rent", 20, "FIXED", ""],
        ["2026-01", "EXPENSE", "Rent", 25, "FIXED", ""],
        ["2026-02", "EXPENSE", "Materials", 10, "VARIABLE", ""],
      ],
      categories,
      plan,
    );

    expect(result).toMatchObject({
      ok: false,
      issues: [
        { row: 3, code: "duplicateRow", value: "row 2" },
        { row: 5, code: "duplicateRow", value: "row 4" },
        { row: 6, code: "missingIncome", value: "2026-02" },
      ],
    });
  });

  it("rejects unknown and ambiguous category names", () => {
    const duplicateCategories = [
      ...categories,
      { id: "rent-two", nameAr: "إيجار آخر", nameEn: "Rent" },
    ];
    const result = validateBudgetImportRows(
      [
        [...BUDGET_IMPORT_HEADERS],
        ["2026-01", "INCOME", "", 100, "", ""],
        ["2026-01", "EXPENSE", "Rent", 20, "FIXED", ""],
        ["2026-01", "EXPENSE", "Travel", 10, "VARIABLE", ""],
      ],
      duplicateCategories,
      plan,
    );

    expect(result).toMatchObject({
      ok: false,
      issues: [
        { row: 3, code: "ambiguousCategory", value: "Rent" },
        { row: 4, code: "unknownCategory", value: "Travel" },
      ],
    });
  });

  it("allows generated disambiguated category references to round-trip", () => {
    const duplicateCategories = [
      { id: "rent-one", nameAr: "الإيجار", nameEn: "Rent" },
      { id: "rent-two", nameAr: "إيجار آخر", nameEn: "Rent" },
    ];
    const reference = uniqueCategoryReference(duplicateCategories[1], duplicateCategories, "en");
    const result = validateBudgetImportRows(
      [
        [...BUDGET_IMPORT_HEADERS],
        ["2026-01", "INCOME", "", 100, "", ""],
        ["2026-01", "EXPENSE", reference, 25, "FIXED", ""],
      ],
      duplicateCategories,
      plan,
    );

    expect(reference).toBe("Rent [rent-two]");
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.items[1].expenseCategoryId).toBe("rent-two");
  });

  it("qualifies a generated name that collides with the other language", () => {
    const crossLanguageCategories = [
      { id: "one", nameAr: "الأولى", nameEn: "Rent" },
      { id: "two", nameAr: "Rent", nameEn: "Second" },
    ];
    expect(uniqueCategoryReference(crossLanguageCategories[0], crossLanguageCategories, "en"))
      .toBe("Rent [one]");
  });

  it("accepts an existing inactive category supplied by the server lookup", () => {
    const inactive = { id: "old", nameAr: "فئة قديمة", nameEn: "Old category" };
    const result = validateBudgetImportRows(
      [
        [...BUDGET_IMPORT_HEADERS],
        ["2026-01", "INCOME", "", 100, "", ""],
        ["2026-01", "EXPENSE", "Old category", 25, "FIXED", ""],
      ],
      [...categories, inactive],
      plan,
    );
    expect(result).toMatchObject({ ok: true });
  });

  it.each([[-1], [1_000_000_000.01], [12.345], ["QAR 100"], [""]])(
    "rejects an invalid amount %s",
    (amount) => {
      const result = validateBudgetImportRows(
        [
          [...BUDGET_IMPORT_HEADERS],
          ["2026-01", "INCOME", "", amount, "", ""],
        ],
        categories,
        plan,
      );
      expect(result).toMatchObject({
        ok: false,
        issues: expect.arrayContaining([expect.objectContaining({ code: "invalidAmount" })]),
      });
    },
  );

  it("validates category, behavior, notes, and income-only fields", () => {
    const result = validateBudgetImportRows(
      [
        [...BUDGET_IMPORT_HEADERS],
        ["2026-01", "INCOME", "Rent", 100, "VARIABLE", "x".repeat(1001)],
        ["2026-01", "EXPENSE", "", 20, "", ""],
        ["2026-01", "EXPENSE", "Materials", 20, "OCCASIONAL", ""],
      ],
      categories,
      plan,
    );

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        { row: 2, code: "notesTooLong" },
        { row: 2, code: "incomeCategoryNotEmpty", value: "Rent" },
        { row: 2, code: "incomeBehaviorInvalid", value: "VARIABLE" },
        { row: 3, code: "expenseCategoryRequired" },
        { row: 4, code: "invalidBehavior", value: "OCCASIONAL" },
      ]),
    });
  });

  it("caps the number of parsed data rows", () => {
    const rows = [
      [...BUDGET_IMPORT_HEADERS],
      ...Array.from({ length: MAX_BUDGET_IMPORT_ROWS + 1 }, () => ["2026-01", "INCOME", "", 1, "", ""]),
    ];
    expect(validateBudgetImportRows(rows, categories, plan)).toEqual({
      ok: false,
      issues: [{ row: 0, code: "tooManyRows" }],
    });
  });

  it("allows 250 expense categories in a month and rejects the 251st", () => {
    const manyCategories = Array.from({ length: 251 }, (_, index) => ({
      id: `category-${index}`,
      nameAr: `فئة ${index}`,
      nameEn: `Category ${index}`,
    }));
    const rows = [
      [...BUDGET_IMPORT_HEADERS],
      ["2026-01", "INCOME", "", 1_000, "", ""],
      ...manyCategories.map((category) => [
        "2026-01",
        "EXPENSE",
        category.id,
        1,
        "FIXED",
        "",
      ]),
    ];
    const atLimit = validateBudgetImportRows(rows.slice(0, -1), manyCategories, plan);
    const overLimit = validateBudgetImportRows(rows, manyCategories, plan);

    expect(atLimit).toMatchObject({ ok: true });
    expect(overLimit).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([{ row: 253, code: "tooManyCategories", value: "2026-01" }]),
    });
  });
});

describe("budget spreadsheet parser", () => {
  it.each([
    ["xlsx" as const, "budget.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["biff8" as const, "budget.xls", "application/vnd.ms-excel"],
  ])("reads genuine %s workbooks", (bookType, fileName, mimeType) => {
    const bytes = sheetBytes(
      [
        [...BUDGET_IMPORT_HEADERS],
        ["2026-01", "INCOME", "", 100, "", ""],
      ],
      bookType,
    );
    expect(spreadsheetFormat(fileName, mimeType, bytes)).toBe(bookType === "biff8" ? "xls" : "xlsx");
    expect(readBudgetSpreadsheet(bytes)).toMatchObject([
      [...BUDGET_IMPORT_HEADERS],
      ["2026-01", "INCOME", "", 100, "", ""],
    ]);
  });

  it("requires matching extension, MIME type, and binary signature", () => {
    const xlsx = sheetBytes([[...BUDGET_IMPORT_HEADERS]], "xlsx");
    expect(spreadsheetFormat("budget.xls", "application/vnd.ms-excel", xlsx)).toBeNull();
    expect(spreadsheetFormat("budget.xlsx", "text/plain", xlsx)).toBeNull();
    expect(spreadsheetFormat("budget.xlsm", "application/octet-stream", xlsx)).toBeNull();
    expect(spreadsheetFormat("budget.xlsx", "application/octet-stream", new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("accepts an ordinary XLSX archive in the bounded ZIP preflight", () => {
    const xlsx = sheetBytes([[...BUDGET_IMPORT_HEADERS]], "xlsx");
    expect(() => assertSafeBudgetXlsxArchive(xlsx)).not.toThrow();
  });

  it("rejects XLSX entries with a decompression-bomb ratio before parsing", () => {
    const archive = syntheticZip([{
      name: "xl/worksheets/sheet1.xml",
      compressedSize: 100,
      uncompressedSize: 100 * MAX_BUDGET_XLSX_COMPRESSION_RATIO + 1,
    }]);
    expect(() => assertSafeBudgetXlsxArchive(archive)).toThrow("badFile");
    expect(() => readBudgetSpreadsheet(archive)).toThrow("badFile");
  });

  it("caps the aggregate XLSX uncompressed size", () => {
    const entrySize = Math.floor(MAX_BUDGET_XLSX_UNCOMPRESSED_BYTES / 8) + 1;
    const archive = syntheticZip(Array.from({ length: 9 }, (_, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      compressedSize: Math.ceil(entrySize / MAX_BUDGET_XLSX_COMPRESSION_RATIO),
      uncompressedSize: entrySize,
    })));
    expect(() => assertSafeBudgetXlsxArchive(archive)).toThrow("badFile");
  });

  it("caps the XLSX central-directory entry count", () => {
    const archive = syntheticZip(Array.from({ length: MAX_BUDGET_XLSX_ENTRIES + 1 }, (_, index) => ({
      name: `entry-${index}.xml`,
      compressedSize: 0,
      uncompressedSize: 0,
      method: 0,
    })));
    expect(() => assertSafeBudgetXlsxArchive(archive)).toThrow("badFile");
  });

  it("rejects encrypted, Zip64, and malformed XLSX archives", () => {
    const encrypted = syntheticZip([{
      name: "xl/workbook.xml",
      compressedSize: 8,
      uncompressedSize: 8,
      method: 0,
      flags: 1,
    }]);
    expect(() => assertSafeBudgetXlsxArchive(encrypted)).toThrow("badFile");

    const zip64Extra = new Uint8Array([0x01, 0x00, 0x00, 0x00]);
    const zip64 = syntheticZip([{
      name: "xl/workbook.xml",
      compressedSize: 8,
      uncompressedSize: 8,
      method: 0,
      extra: zip64Extra,
    }]);
    expect(() => assertSafeBudgetXlsxArchive(zip64)).toThrow("badFile");

    const malformed = syntheticZip([{
      name: "xl/workbook.xml",
      compressedSize: 8,
      uncompressedSize: 8,
      method: 0,
    }]);
    malformed[30] ^= 0xff; // Local and central filenames no longer agree.
    expect(() => assertSafeBudgetXlsxArchive(malformed)).toThrow("badFile");
  });

  it("rejects formula cells even when the workbook contains a cached value", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [...BUDGET_IMPORT_HEADERS],
      ["2026-01", "INCOME", "", 2, "", ""],
    ]);
    sheet.D2 = { t: "n", v: 2, f: "1+1" };
    XLSX.utils.book_append_sheet(workbook, sheet, "Budget");
    const bytes = new Uint8Array(XLSX.write(workbook, { bookType: "xlsx", type: "array" }));

    expect(() => readBudgetSpreadsheet(bytes)).toThrow("formulasNotAllowed");
  });

  it("keeps a genuine Excel date cell in its intended calendar month", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [...BUDGET_IMPORT_HEADERS],
      [null, "INCOME", "", 100, "", ""],
    ]);
    sheet.A2 = { t: "n", v: 46023, z: "yyyy-mm-dd" }; // Excel serial for 2026-01-01.
    XLSX.utils.book_append_sheet(workbook, sheet, "Budget");
    const bytes = new Uint8Array(XLSX.write(workbook, { bookType: "xlsx", type: "array" }));
    const rows = readBudgetSpreadsheet(bytes);

    expect(rows[1][0]).toBeInstanceOf(Date);
    expect(validateBudgetImportRows(rows, categories, plan)).toMatchObject({
      ok: true,
      months: ["2026-01"],
    });
  });

  it("rejects a workbook whose original range exceeds the parser cap", () => {
    const rows = [
      [...BUDGET_IMPORT_HEADERS],
      ...Array.from({ length: MAX_BUDGET_IMPORT_ROWS + 25 }, () => ["2026-01", "INCOME", "", 1, "", ""]),
    ];
    expect(() => readBudgetSpreadsheet(sheetBytes(rows, "xlsx"))).toThrow("tooManyRows");
  });
});

describe("budget sample month generation", () => {
  it("includes every overlapping calendar month", () => {
    expect(budgetPlanMonths(plan)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("identifies deleted-category rows that touched-month replacement must preserve", () => {
    expect(isOrphanedBudgetExpense({ kind: "EXPENSE", key: "deleted-category", expenseCategoryId: null }))
      .toBe(true);
    expect(isOrphanedBudgetExpense({ kind: "INCOME", key: "INCOME", expenseCategoryId: null }))
      .toBe(false);
    expect(isOrphanedBudgetExpense({ kind: "EXPENSE", key: "rent", expenseCategoryId: "rent" }))
      .toBe(false);
  });

  it("builds a category-aware sample that round-trips current values", () => {
    const currentCategories = [
      ...categories,
      { id: "inactive", nameAr: "قديمة", nameEn: "Inactive" },
    ];
    const rows = buildBudgetSampleRows(
      plan,
      currentCategories,
      [
        { month: new Date("2026-01-01T00:00:00.000Z"), key: "INCOME", amount: 9_000, behavior: "FIXED", notes: null },
        { month: new Date("2026-01-01T00:00:00.000Z"), key: "inactive", amount: 200, behavior: "VARIABLE", notes: "Legacy" },
      ],
      "en",
    );
    const validated = validateBudgetImportRows(rows, currentCategories, plan);

    expect(validated).toMatchObject({ ok: true, months: ["2026-01", "2026-02", "2026-03"] });
    if (!validated.ok) throw new Error("expected generated sample to round-trip");
    expect(validated.items).toContainEqual(
      expect.objectContaining({ month: "2026-01", key: "inactive", amount: 200, behavior: "VARIABLE", notes: "Legacy" }),
    );
  });
});
