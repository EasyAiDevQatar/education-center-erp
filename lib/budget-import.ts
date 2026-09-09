import * as XLSX from "xlsx";

export const BUDGET_IMPORT_HEADERS = [
  "Month",
  "Type",
  "Category",
  "Amount",
  "Behavior",
  "Notes",
] as const;

export const BUDGET_IMPORT_HEADERS_AR = [
  "الشهر",
  "النوع",
  "الفئة",
  "المبلغ",
  "السلوك",
  "ملاحظات",
] as const;

export const MAX_BUDGET_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_BUDGET_IMPORT_ROWS = 10_000;
export const MAX_BUDGET_IMPORT_ISSUES = 50;
export const MAX_BUDGET_AMOUNT = 1_000_000_000;

// XLSX files are ZIP archives. Keep these limits comfortably above a normal
// budget workbook while bounding the work SheetJS can be asked to do before
// it gets a chance to decompress attacker-controlled XML.
export const MAX_BUDGET_XLSX_ENTRIES = 2_048;
export const MAX_BUDGET_XLSX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
export const MAX_BUDGET_XLSX_COMPRESSION_RATIO = 200;

export type BudgetSpreadsheetFormat = "xls" | "xlsx";
export type BudgetImportKind = "INCOME" | "EXPENSE";
export type BudgetCostBehavior = "FIXED" | "VARIABLE";

export type BudgetImportCategory = {
  id: string;
  nameAr: string;
  nameEn: string;
};

export type BudgetImportPlan = {
  startDate: Date;
  endDate: Date;
};

export type BudgetImportItem = {
  sourceRow: number;
  month: string;
  key: string;
  kind: BudgetImportKind;
  expenseCategoryId: string | null;
  label: string;
  amount: number;
  behavior: BudgetCostBehavior;
  notes: string | null;
};

export type BudgetSampleItem = {
  month: Date;
  key: string;
  amount: unknown;
  behavior: string;
  notes: string | null;
};

export type BudgetImportIssueCode =
  | "invalidColumns"
  | "tooManyRows"
  | "invalidMonth"
  | "outsidePeriod"
  | "invalidType"
  | "incomeCategoryNotEmpty"
  | "expenseCategoryRequired"
  | "unknownCategory"
  | "ambiguousCategory"
  | "invalidAmount"
  | "invalidBehavior"
  | "incomeBehaviorInvalid"
  | "tooManyCategories"
  | "notesTooLong"
  | "duplicateRow"
  | "missingIncome";

export type BudgetImportIssue = {
  row: number;
  code: BudgetImportIssueCode;
  value?: string;
};

export type BudgetImportValidation =
  | {
      ok: true;
      items: BudgetImportItem[];
      months: string[];
      sourceRows: number;
    }
  | {
      ok: false;
      issues: BudgetImportIssue[];
    };

type CellValue = string | number | boolean | Date | null | undefined;

const HEADER_ALIASES = BUDGET_IMPORT_HEADERS.map((header, index) => [
  header,
  BUDGET_IMPORT_HEADERS_AR[index],
]);

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lookupKey(value: unknown): string {
  return normalizeText(value).toLocaleLowerCase("en-US");
}

function displayValue(value: unknown): string {
  const text = normalizeText(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function trimTrailingEmptyCells(row: CellValue[]): CellValue[] {
  let end = row.length;
  while (end > 0 && normalizeText(row[end - 1]) === "") end -= 1;
  return row.slice(0, end);
}

function hasExactHeaders(row: CellValue[]): boolean {
  const headers = trimTrailingEmptyCells(row);
  if (headers.length !== HEADER_ALIASES.length) return false;
  return headers.every((value, index) => {
    const key = lookupKey(value);
    return HEADER_ALIASES[index].some((alias) => lookupKey(alias) === key);
  });
}

function parseMonth(value: CellValue): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // SheetJS represents Excel's timezone-free calendar dates at local midnight.
    // Local fields preserve the date displayed in Excel (not the previous UTC day
    // in positive-offset timezones such as Qatar).
    const year = value.getFullYear();
    const month = value.getMonth() + 1;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  }

  const text = normalizeText(value);
  const match = /^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] ? Number(match[3]) : 1;
  if (year < 1900 || year > 9999 || month < 1 || month > 12) return null;
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function planMonthRange(plan: BudgetImportPlan): { start: string; end: string } {
  const key = (value: Date) =>
    `${String(value.getUTCFullYear()).padStart(4, "0")}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
  return { start: key(plan.startDate), end: key(plan.endDate) };
}

function parseKind(value: CellValue): BudgetImportKind | null {
  const normalized = lookupKey(value);
  if (normalized === "income" || normalized === "دخل" || normalized === "الدخل") {
    return "INCOME";
  }
  if (
    normalized === "expense" ||
    normalized === "مصروف" ||
    normalized === "مصروفات" ||
    normalized === "المصروف"
  ) {
    return "EXPENSE";
  }
  return null;
}

function parseBehavior(value: CellValue): BudgetCostBehavior | null {
  const normalized = lookupKey(value);
  if (normalized === "fixed" || normalized === "ثابت") return "FIXED";
  if (normalized === "variable" || normalized === "متغير") return "VARIABLE";
  return null;
}

function parseAmount(value: CellValue): number | null {
  const hasSupportedPrecision = (number: number) =>
    Math.abs(number * 100 - Math.round(number * 100)) < 1e-7;
  if (typeof value === "number") {
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      value > MAX_BUDGET_AMOUNT ||
      !hasSupportedPrecision(value)
    ) return null;
    return value;
  }
  const text = normalizeText(value);
  if (!text) return null;
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(text)) return null;
  const parsed = Number(text.replace(/,/g, ""));
  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    parsed > MAX_BUDGET_AMOUNT ||
    !hasSupportedPrecision(parsed)
  ) return null;
  return parsed;
}

function categoryLookup(categories: BudgetImportCategory[]) {
  const values = new Map<string, BudgetImportCategory[]>();
  const add = (alias: string, category: BudgetImportCategory) => {
    const key = lookupKey(alias);
    if (!key) return;
    const found = values.get(key) ?? [];
    if (!found.some((item) => item.id === category.id)) found.push(category);
    values.set(key, found);
  };
  for (const category of categories) {
    add(category.id, category);
    add(category.nameAr, category);
    add(category.nameEn, category);
    // The generated template uses this unambiguous form only if two categories
    // share the same translated name.
    add(`${category.nameAr} [${category.id}]`, category);
    add(`${category.nameEn} [${category.id}]`, category);
  }
  return values;
}

function categoryLabel(category: BudgetImportCategory): string {
  return `${category.nameEn} / ${category.nameAr}`;
}

/**
 * Validate the first worksheet before any database write. A successful import
 * replaces complete months, so every represented month must contain exactly one
 * income row and every logical expense category may appear only once.
 */
export function validateBudgetImportRows(
  rows: CellValue[][],
  categories: BudgetImportCategory[],
  plan: BudgetImportPlan,
): BudgetImportValidation {
  if (!rows.length || !hasExactHeaders(rows[0] ?? [])) {
    return { ok: false, issues: [{ row: 1, code: "invalidColumns" }] };
  }

  const populatedRows = rows.slice(1).filter((row) => trimTrailingEmptyCells(row).length > 0);
  if (populatedRows.length > MAX_BUDGET_IMPORT_ROWS) {
    return { ok: false, issues: [{ row: 0, code: "tooManyRows" }] };
  }

  const issues: BudgetImportIssue[] = [];
  const pushIssue = (issue: BudgetImportIssue) => {
    if (issues.length < MAX_BUDGET_IMPORT_ISSUES) issues.push(issue);
  };
  const lookup = categoryLookup(categories);
  const planRange = planMonthRange(plan);
  const items: BudgetImportItem[] = [];
  const representedMonths = new Map<string, number>();
  const logicalKeys = new Map<string, number>();
  const expensesPerMonth = new Map<string, number>();

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (trimTrailingEmptyCells(row).length === 0) continue;
    const sourceRow = index + 1;
    if (row.slice(BUDGET_IMPORT_HEADERS.length).some((value) => normalizeText(value) !== "")) {
      pushIssue({ row: sourceRow, code: "invalidColumns" });
      continue;
    }

    const month = parseMonth(row[0]);
    if (!month) {
      pushIssue({ row: sourceRow, code: "invalidMonth", value: displayValue(row[0]) });
    } else if (month < planRange.start || month > planRange.end) {
      pushIssue({ row: sourceRow, code: "outsidePeriod", value: month });
    } else if (!representedMonths.has(month)) {
      representedMonths.set(month, sourceRow);
    }

    const kind = parseKind(row[1]);
    if (!kind) pushIssue({ row: sourceRow, code: "invalidType", value: displayValue(row[1]) });

    const amount = parseAmount(row[3]);
    if (amount == null) {
      pushIssue({ row: sourceRow, code: "invalidAmount", value: displayValue(row[3]) });
    }

    const notesText = normalizeText(row[5]);
    if (notesText.length > 1000) pushIssue({ row: sourceRow, code: "notesTooLong" });

    if (!month || month < planRange.start || month > planRange.end || !kind || amount == null) {
      continue;
    }

    if (kind === "INCOME") {
      if (normalizeText(row[2])) {
        pushIssue({ row: sourceRow, code: "incomeCategoryNotEmpty", value: displayValue(row[2]) });
      }
      const behaviorText = normalizeText(row[4]);
      const behavior = behaviorText ? parseBehavior(row[4]) : "FIXED";
      if (behavior !== "FIXED") {
        pushIssue({ row: sourceRow, code: "incomeBehaviorInvalid", value: displayValue(row[4]) });
      }
      const logicalKey = `${month}|INCOME`;
      if (logicalKeys.has(logicalKey)) {
        pushIssue({ row: sourceRow, code: "duplicateRow", value: `row ${logicalKeys.get(logicalKey)}` });
      } else {
        logicalKeys.set(logicalKey, sourceRow);
      }
      items.push({
        sourceRow,
        month,
        key: "INCOME",
        kind,
        expenseCategoryId: null,
        label: "Expected income / الدخل المتوقع",
        amount,
        behavior: "FIXED",
        notes: notesText || null,
      });
      continue;
    }

    const categoryText = normalizeText(row[2]);
    if (!categoryText) {
      pushIssue({ row: sourceRow, code: "expenseCategoryRequired" });
      continue;
    }
    const matches = lookup.get(lookupKey(categoryText)) ?? [];
    if (matches.length === 0) {
      pushIssue({ row: sourceRow, code: "unknownCategory", value: displayValue(row[2]) });
      continue;
    }
    if (matches.length > 1) {
      pushIssue({ row: sourceRow, code: "ambiguousCategory", value: displayValue(row[2]) });
      continue;
    }
    const behavior = parseBehavior(row[4]);
    if (!behavior) {
      pushIssue({ row: sourceRow, code: "invalidBehavior", value: displayValue(row[4]) });
      continue;
    }
    const category = matches[0];
    const monthExpenseCount = (expensesPerMonth.get(month) ?? 0) + 1;
    expensesPerMonth.set(month, monthExpenseCount);
    if (monthExpenseCount > 250) {
      pushIssue({ row: sourceRow, code: "tooManyCategories", value: month });
    }
    const logicalKey = `${month}|EXPENSE|${category.id}`;
    if (logicalKeys.has(logicalKey)) {
      pushIssue({ row: sourceRow, code: "duplicateRow", value: `row ${logicalKeys.get(logicalKey)}` });
    } else {
      logicalKeys.set(logicalKey, sourceRow);
    }
    items.push({
      sourceRow,
      month,
      key: category.id,
      kind,
      expenseCategoryId: category.id,
      label: categoryLabel(category),
      amount,
      behavior,
      notes: notesText || null,
    });
  }

  for (const [month, row] of representedMonths) {
    if (!logicalKeys.has(`${month}|INCOME`)) pushIssue({ row, code: "missingIncome", value: month });
  }
  if (representedMonths.size === 0 && issues.length === 0) {
    pushIssue({ row: 2, code: "invalidMonth" });
  }

  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    items,
    months: [...representedMonths.keys()].sort(),
    sourceRows: populatedRows.length,
  };
}

export function spreadsheetFormat(
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
): BudgetSpreadsheetFormat | null {
  const extension = /\.xlsx$/i.test(fileName) ? "xlsx" : /\.xls$/i.test(fileName) ? "xls" : null;
  if (!extension) return null;
  const mime = mimeType.toLocaleLowerCase("en-US").split(";", 1)[0].trim();
  const allowedMime =
    !mime ||
    mime === "application/octet-stream" ||
    (extension === "xlsx" && mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") ||
    (extension === "xls" &&
      ["application/vnd.ms-excel", "application/x-msexcel", "application/xls"].includes(mime));
  if (!allowedMime) return null;

  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const cfb = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const isCfb = bytes.length >= cfb.length && cfb.every((value, index) => bytes[index] === value);
  return extension === "xlsx" ? (isZip ? "xlsx" : null) : isCfb ? "xls" : null;
}

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR = 0x07064b50;
const ZIP64_EXTRA_FIELD = 0x0001;
const ZIP_AES_EXTRA_FIELD = 0x9901;
const MAX_ZIP_COMMENT_BYTES = 65_535;

function isZipArchive(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

function rejectUnsafeXlsx(): never {
  throw new Error("badFile");
}

/**
 * Check an XLSX ZIP's central directory before SheetJS inflates any content.
 *
 * This deliberately supports only the two compression methods used by normal
 * Office Open XML files (stored and deflate). Multi-disk, encrypted, Zip64,
 * ambiguous, or internally inconsistent archives are rejected rather than
 * handed to a permissive ZIP parser.
 */
export function assertSafeBudgetXlsxArchive(bytes: Uint8Array): void {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const uint16 = (offset: number) => view.getUint16(offset, true);
    const uint32 = (offset: number) => view.getUint32(offset, true);
    const hasRange = (offset: number, length: number) =>
      Number.isSafeInteger(offset) &&
      Number.isSafeInteger(length) &&
      offset >= 0 &&
      length >= 0 &&
      offset <= bytes.length - length;

    if (!isZipArchive(bytes)) rejectUnsafeXlsx();

    // EOCD can be followed only by its bounded comment. Searching backwards
    // and requiring an exact end prevents accepting a signature embedded in a
    // comment or trailing payload.
    const earliestEocd = Math.max(0, bytes.length - 22 - MAX_ZIP_COMMENT_BYTES);
    let eocdOffset = -1;
    for (let offset = bytes.length - 22; offset >= earliestEocd; offset -= 1) {
      if (uint32(offset) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue;
      const commentLength = uint16(offset + 20);
      if (offset + 22 + commentLength === bytes.length) {
        eocdOffset = offset;
        break;
      }
    }
    if (eocdOffset < 0) rejectUnsafeXlsx();

    if (
      eocdOffset >= 20 &&
      uint32(eocdOffset - 20) === ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR
    ) {
      rejectUnsafeXlsx();
    }

    const diskNumber = uint16(eocdOffset + 4);
    const directoryDisk = uint16(eocdOffset + 6);
    const entriesOnDisk = uint16(eocdOffset + 8);
    const entryCount = uint16(eocdOffset + 10);
    const directorySize = uint32(eocdOffset + 12);
    const directoryOffset = uint32(eocdOffset + 16);

    // Sentinel values require Zip64 records, which are intentionally outside
    // this importer's bounded format. Non-zero disk numbers are split ZIPs.
    if (
      diskNumber !== 0 ||
      directoryDisk !== 0 ||
      entriesOnDisk !== entryCount ||
      entriesOnDisk === 0xffff ||
      entryCount === 0xffff ||
      directorySize === 0xffffffff ||
      directoryOffset === 0xffffffff ||
      entryCount === 0 ||
      entryCount > MAX_BUDGET_XLSX_ENTRIES ||
      !hasRange(directoryOffset, directorySize) ||
      directoryOffset + directorySize !== eocdOffset
    ) {
      rejectUnsafeXlsx();
    }

    const directoryEnd = directoryOffset + directorySize;
    let cursor = directoryOffset;
    let totalCompressed = 0;
    let totalUncompressed = 0;
    const localOffsets = new Set<number>();
    const localSpans: Array<{ start: number; end: number }> = [];

    const assertSafeExtraFields = (start: number, length: number) => {
      if (!hasRange(start, length)) rejectUnsafeXlsx();
      const end = start + length;
      let extraCursor = start;
      while (extraCursor < end) {
        if (extraCursor + 4 > end) rejectUnsafeXlsx();
        const id = uint16(extraCursor);
        const size = uint16(extraCursor + 2);
        extraCursor += 4;
        if (extraCursor + size > end) rejectUnsafeXlsx();
        if (id === ZIP64_EXTRA_FIELD || id === ZIP_AES_EXTRA_FIELD) rejectUnsafeXlsx();
        extraCursor += size;
      }
    };

    for (let index = 0; index < entryCount; index += 1) {
      if (!hasRange(cursor, 46) || cursor + 46 > directoryEnd) rejectUnsafeXlsx();
      if (uint32(cursor) !== ZIP_CENTRAL_DIRECTORY_HEADER) rejectUnsafeXlsx();

      const flags = uint16(cursor + 8);
      const compressionMethod = uint16(cursor + 10);
      const compressedSize = uint32(cursor + 20);
      const uncompressedSize = uint32(cursor + 24);
      const fileNameLength = uint16(cursor + 28);
      const extraLength = uint16(cursor + 30);
      const commentLength = uint16(cursor + 32);
      const startingDisk = uint16(cursor + 34);
      const localOffset = uint32(cursor + 42);
      const variableLength = fileNameLength + extraLength + commentLength;

      if (
        fileNameLength === 0 ||
        !hasRange(cursor + 46, variableLength) ||
        cursor + 46 + variableLength > directoryEnd ||
        // Bits 0, 6, and 13 cover traditional, strong, and masked encryption.
        (flags & ((1 << 0) | (1 << 6) | (1 << 13))) !== 0 ||
        (compressionMethod !== 0 && compressionMethod !== 8) ||
        compressedSize === 0xffffffff ||
        uncompressedSize === 0xffffffff ||
        startingDisk !== 0 ||
        localOffset === 0xffffffff ||
        (compressedSize === 0 && uncompressedSize !== 0) ||
        (compressionMethod === 0 && compressedSize !== uncompressedSize) ||
        (uncompressedSize > 0 &&
          uncompressedSize / Math.max(1, compressedSize) > MAX_BUDGET_XLSX_COMPRESSION_RATIO)
      ) {
        rejectUnsafeXlsx();
      }

      assertSafeExtraFields(cursor + 46 + fileNameLength, extraLength);
      totalCompressed += compressedSize;
      totalUncompressed += uncompressedSize;
      if (
        !Number.isSafeInteger(totalCompressed) ||
        !Number.isSafeInteger(totalUncompressed) ||
        totalUncompressed > MAX_BUDGET_XLSX_UNCOMPRESSED_BYTES ||
        (totalUncompressed > 0 &&
          totalUncompressed / Math.max(1, totalCompressed) > MAX_BUDGET_XLSX_COMPRESSION_RATIO)
      ) {
        rejectUnsafeXlsx();
      }

      if (localOffsets.has(localOffset) || !hasRange(localOffset, 30)) rejectUnsafeXlsx();
      localOffsets.add(localOffset);
      if (uint32(localOffset) !== ZIP_LOCAL_FILE_HEADER) rejectUnsafeXlsx();

      const localFlags = uint16(localOffset + 6);
      const localMethod = uint16(localOffset + 8);
      const localCompressedSize = uint32(localOffset + 18);
      const localUncompressedSize = uint32(localOffset + 22);
      const localFileNameLength = uint16(localOffset + 26);
      const localExtraLength = uint16(localOffset + 28);
      const usesDataDescriptor = (flags & (1 << 3)) !== 0;
      const localVariableLength = localFileNameLength + localExtraLength;

      if (
        localFlags !== flags ||
        localMethod !== compressionMethod ||
        localFileNameLength !== fileNameLength ||
        localCompressedSize === 0xffffffff ||
        localUncompressedSize === 0xffffffff ||
        !hasRange(localOffset + 30, localVariableLength) ||
        (!usesDataDescriptor &&
          (localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize)) ||
        (usesDataDescriptor &&
          ((localCompressedSize !== 0 && localCompressedSize !== compressedSize) ||
            (localUncompressedSize !== 0 && localUncompressedSize !== uncompressedSize)))
      ) {
        rejectUnsafeXlsx();
      }

      for (let nameIndex = 0; nameIndex < fileNameLength; nameIndex += 1) {
        if (bytes[cursor + 46 + nameIndex] !== bytes[localOffset + 30 + nameIndex]) {
          rejectUnsafeXlsx();
        }
      }
      assertSafeExtraFields(localOffset + 30 + localFileNameLength, localExtraLength);

      const dataStart = localOffset + 30 + localVariableLength;
      if (!hasRange(dataStart, compressedSize) || dataStart + compressedSize > directoryOffset) {
        rejectUnsafeXlsx();
      }
      localSpans.push({ start: localOffset, end: dataStart + compressedSize });
      cursor += 46 + variableLength;
    }

    if (cursor !== directoryEnd) rejectUnsafeXlsx();
    localSpans.sort((left, right) => left.start - right.start);
    for (let index = 1; index < localSpans.length; index += 1) {
      if (localSpans[index].start < localSpans[index - 1].end) rejectUnsafeXlsx();
    }
  } catch (error) {
    if (error instanceof Error && error.message === "badFile") throw error;
    rejectUnsafeXlsx();
  }
}

export function readBudgetSpreadsheet(bytes: Uint8Array): CellValue[][] {
  // Legacy BIFF8 .xls files are CFB containers rather than ZIP archives and do
  // not pass through this XLSX-specific preflight.
  if (isZipArchive(bytes)) assertSafeBudgetXlsxArchive(bytes);
  const workbook = XLSX.read(bytes, {
    type: "array",
    cellDates: true,
    cellFormula: true,
    cellHTML: false,
    cellStyles: false,
    bookFiles: false,
    bookVBA: true,
    sheetRows: MAX_BUDGET_IMPORT_ROWS + 2,
    sheets: 0,
    WTF: false,
    dense: false,
  });
  if ((workbook as XLSX.WorkBook & { vbaraw?: unknown }).vbaraw) {
    throw new Error("macrosNotAllowed");
  }
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];
  const sheet = workbook.Sheets[firstSheet];
  const fullReference = (sheet as XLSX.WorkSheet & { "!fullref"?: string })["!fullref"];
  if (fullReference && sheet["!ref"]) {
    const fullRange = XLSX.utils.decode_range(fullReference);
    const parsedRange = XLSX.utils.decode_range(sheet["!ref"]);
    if (fullRange.e.r > parsedRange.e.r) throw new Error("tooManyRows");
  }
  const hasFormula = Object.entries(sheet).some(
    ([address, cell]) =>
      !address.startsWith("!") &&
      Boolean(cell && typeof cell === "object" && "f" in cell && (cell as { f?: unknown }).f),
  );
  if (hasFormula) throw new Error("formulasNotAllowed");
  return XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
}

export function budgetPlanMonths(plan: BudgetImportPlan): string[] {
  const first = new Date(Date.UTC(plan.startDate.getUTCFullYear(), plan.startDate.getUTCMonth(), 1));
  const last = new Date(Date.UTC(plan.endDate.getUTCFullYear(), plan.endDate.getUTCMonth(), 1));
  const months: string[] = [];
  for (const cursor = first; cursor <= last; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export function uniqueCategoryReference(
  category: BudgetImportCategory,
  categories: BudgetImportCategory[],
  locale: "ar" | "en",
): string {
  const name = locale === "ar" ? category.nameAr : category.nameEn;
  const collisions = categories.filter((item) =>
    lookupKey(item.nameAr) === lookupKey(name) || lookupKey(item.nameEn) === lookupKey(name),
  );
  return collisions.length > 1 ? `${name} [${category.id}]` : name;
}

/**
 * A deleted category is retained as a null relation by the schema so historic
 * budgets remain intelligible. Spreadsheet replacement cannot address that
 * row by category name, therefore it must never silently delete it.
 */
export function isOrphanedBudgetExpense(item: {
  kind: string;
  key: string;
  expenseCategoryId: string | null;
}): boolean {
  return item.kind === "EXPENSE" && item.key !== "INCOME" && item.expenseCategoryId === null;
}

export function buildBudgetSampleRows(
  plan: BudgetImportPlan,
  categories: BudgetImportCategory[],
  items: BudgetSampleItem[],
  locale: "ar" | "en",
): CellValue[][] {
  const isArabic = locale === "ar";
  const values = {
    income: isArabic ? "دخل" : "INCOME",
    expense: isArabic ? "مصروف" : "EXPENSE",
    fixed: isArabic ? "ثابت" : "FIXED",
    variable: isArabic ? "متغير" : "VARIABLE",
  };
  const itemMap = new Map(
    items.map((item) => [`${item.month.toISOString().slice(0, 7)}|${item.key}`, item]),
  );
  const rows: CellValue[][] = [
    [...(isArabic ? BUDGET_IMPORT_HEADERS_AR : BUDGET_IMPORT_HEADERS)],
  ];
  for (const month of budgetPlanMonths(plan)) {
    const income = itemMap.get(`${month}|INCOME`);
    rows.push([
      month,
      values.income,
      "",
      income == null ? 0 : Number(income.amount),
      "",
      String(income?.notes ?? "").slice(0, 1000),
    ]);
    for (const category of categories) {
      const item = itemMap.get(`${month}|${category.id}`);
      rows.push([
        month,
        values.expense,
        uniqueCategoryReference(category, categories, locale),
        item == null ? 0 : Number(item.amount),
        item?.behavior === "VARIABLE" ? values.variable : values.fixed,
        String(item?.notes ?? "").slice(0, 1000),
      ]);
    }
  }
  return rows;
}
