/**
 * Legacy Excel importer.
 * Loads the center's existing workbook (مراكز تعليمية.xlsx) into the ERP:
 *   - الحصص اليومية  -> Session (+ Student, Teacher)
 *   - الدخل المحصل   -> Payment
 *   - المصروفات      -> Expense
 * Then prints a reconciliation report (counts + sums) so the imported data can
 * be checked against the workbook's own totals.
 *
 * Run: node --import tsx prisma/import-legacy-xlsx.ts
 *      (optionally set WORKBOOK=/path/to.xlsx)
 */
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { parseGrade } from "../lib/grade";

const db = new PrismaClient();

const DOWNLOADS = "C:/Users/IMOHAMED/Downloads";

function findWorkbook(): string {
  if (process.env.WORKBOOK) return process.env.WORKBOOK;
  const f = fs
    .readdirSync(DOWNLOADS)
    .find((x) => x.endsWith(".xlsx") && x.includes("مراكز"));
  if (!f) throw new Error("Workbook not found in Downloads");
  return path.join(DOWNLOADS, f);
}

/** Normalize an ExcelJS cell value (handles formulas, rich text, dates). */
function val(cell: ExcelJS.Cell): unknown {
  const v = cell.value as unknown;
  if (v && typeof v === "object") {
    const o = v as { result?: unknown; text?: unknown };
    if ("result" in o) return o.result;
    if ("text" in o) return o.text;
  }
  return v;
}
function num(v: unknown): number | null {
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}
function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}
function asDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "string" && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

async function main() {
  const file = findWorkbook();
  console.log("Reading:", file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  console.log("Wiping transactional data...");
  await db.session.deleteMany();
  await db.payment.deleteMany();
  await db.package.deleteMany();
  await db.teacherPayout.deleteMany();
  await db.expense.deleteMany();
  await db.auditLog.deleteMany();
  await db.student.deleteMany();

  // Caches
  const levels = await db.gradeLevel.findMany();
  const levelByCode = new Map(levels.map((l) => [l.code, l.id]));
  const teacherByName = new Map<string, string>();
  for (const t of await db.teacher.findMany()) teacherByName.set(t.name, t.id);
  const studentByName = new Map<string, string>();
  const cats = await db.expenseCategory.findMany();
  const catByName = new Map(cats.map((c) => [c.nameAr, c.id]));

  async function teacherId(name: string): Promise<string> {
    const key = name.trim();
    let id = teacherByName.get(key);
    if (!id) {
      const t = await db.teacher.create({ data: { name: key, commissionPct: 50 } });
      id = t.id;
      teacherByName.set(key, id);
    }
    return id;
  }
  async function studentId(name: string): Promise<string> {
    const key = name.trim();
    let id = studentByName.get(key);
    if (!id) {
      const s = await db.student.create({ data: { name: key } });
      id = s.id;
      studentByName.set(key, id);
    }
    return id;
  }

  /* ---- Sessions ---- */
  const wsS = wb.getWorksheet("الحصص اليومية")!;
  let sCount = 0;
  let sSum = 0;
  let sSkipped = 0;
  const totalRows = wsS.rowCount;
  for (let i = 2; i <= totalRows; i++) {
    const row = wsS.getRow(i);
    const student = str(val(row.getCell(2)));
    const teacher = str(val(row.getCell(3)));
    if (!student || !teacher) continue;
    const date = asDate(val(row.getCell(1)));
    const hours = num(val(row.getCell(4)));
    const grade = parseGrade(val(row.getCell(5)));
    const price = num(val(row.getCell(6))) ?? 0;
    const total = num(val(row.getCell(7))) ?? (hours ?? 0) * price;
    const paidAmount = num(val(row.getCell(8)));
    if (!date || !hours || !grade) {
      sSkipped++;
      continue;
    }
    const gradeLevelId = levelByCode.get(grade.level);
    if (!gradeLevelId) {
      sSkipped++;
      continue;
    }
    const paymentStatus =
      paidAmount != null && total > 0
        ? paidAmount >= total
          ? "PAID"
          : paidAmount > 0
            ? "PARTIAL"
            : "UNPAID"
        : "UNPAID";
    await db.session.create({
      data: {
        date,
        studentId: await studentId(student),
        teacherId: await teacherId(teacher),
        gradeLevelId,
        location: grade.location,
        hours,
        pricePerHour: price,
        total,
        paymentStatus,
      },
    });
    sCount++;
    sSum += total;
  }

  /* ---- Payments (الدخل المحصل) ---- */
  const wsP = wb.getWorksheet("الدخل المحصل")!;
  let pCount = 0;
  let pSum = 0;
  let autoReceipt = 100000;
  for (let i = 2; i <= wsP.rowCount; i++) {
    const row = wsP.getRow(i);
    const amount = num(val(row.getCell(4)));
    if (amount == null) continue;
    const date = asDate(val(row.getCell(1))) ?? new Date();
    const receiptRaw = str(val(row.getCell(2)));
    const student = str(val(row.getCell(3)));
    const teacher = str(val(row.getCell(5)));
    const isMachine = receiptRaw === "ماكينة";
    const receiptNo =
      receiptRaw && !isMachine ? receiptRaw : `M${autoReceipt++}`;
    await db.payment.create({
      data: {
        date,
        receiptNo,
        studentId: student ? await studentId(student) : null,
        amount,
        method: isMachine ? "POS" : "CASH",
        teacherId: teacher ? await teacherId(teacher) : null,
      },
    });
    pCount++;
    pSum += amount;
  }

  /* ---- Expenses (المصروفات) ---- */
  const wsE = wb.getWorksheet("المصروفات")!;
  // Category headers live in row 2, starting at column 4.
  const headerRow = wsE.getRow(2);
  const catCols: { col: number; name: string }[] = [];
  for (let c = 4; c <= wsE.columnCount; c++) {
    const name = str(val(headerRow.getCell(c)));
    if (name) catCols.push({ col: c, name });
  }
  let eCount = 0;
  let eSum = 0;
  let eSkipped = 0;
  for (let i = 3; i <= wsE.rowCount; i++) {
    const row = wsE.getRow(i);
    const date = asDate(val(row.getCell(1)));
    const description = str(val(row.getCell(3)));
    if (!date && !description) continue;
    let amount: number | null = null;
    let catName = "";
    for (const { col, name } of catCols) {
      const v = num(val(row.getCell(col)));
      if (v != null) {
        amount = v;
        catName = name;
        break;
      }
    }
    if (amount == null) {
      eSkipped++;
      continue;
    }
    const categoryId = catByName.get(catName);
    if (!categoryId) {
      eSkipped++;
      continue;
    }
    await db.expense.create({
      data: {
        date: date ?? new Date(),
        description: description || catName,
        categoryId,
        amount,
      },
    });
    eCount++;
    eSum += amount;
  }

  console.log("\n===== Reconciliation =====");
  console.log(`Students created : ${studentByName.size}`);
  console.log(`Teachers total   : ${teacherByName.size}`);
  console.log(`Sessions imported: ${sCount} (skipped ${sSkipped})  sum(total)=${sSum}`);
  console.log(`Payments imported: ${pCount}  sum(amount)=${pSum}`);
  console.log(`Expenses imported: ${eCount} (skipped ${eSkipped})  sum(amount)=${eSum}`);
  console.log(`Net (payments - expenses) = ${pSum - eSum}`);
  console.log("==========================\n");
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
