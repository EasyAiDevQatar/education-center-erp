import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES, FINANCE_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { combineDateTime } from "@/lib/session-time";
import { resolvePricePerHour } from "@/lib/pricing";
import { TABLES, type TableKey } from "@/lib/data-zone";

export type ImportResult = {
  ok?: boolean;
  error?: string;
  created?: number;
  skipped?: number;
  errors?: string[];
};

/** POST /api/import/<table> with multipart form-data { file } */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ table: string }> },
) {
  const session = await getSession();
  if (!session || !STAFF_ROLES.includes(session.role)) {
    return NextResponse.json<ImportResult>({ error: "forbidden" }, { status: 403 });
  }

  const { table } = await ctx.params;
  const spec = TABLES.find((t) => t.key === table);
  if (!spec || !spec.importable) {
    return NextResponse.json<ImportResult>({ error: "unknownTable" }, { status: 404 });
  }
  if (spec.finance && !FINANCE_ROLES.includes(session.role)) {
    return NextResponse.json<ImportResult>({ error: "forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json<ImportResult>({ error: "noFile" }, { status: 400 });
  }

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    return NextResponse.json<ImportResult>({ error: "badFile" }, { status: 400 });
  }
  const ws = wb.worksheets[0];
  if (!ws) return NextResponse.json<ImportResult>({ error: "emptyFile" }, { status: 400 });

  // Map header cells → column keys, accepting the Arabic label or the English key.
  const headerRow = ws.getRow(1);
  const colByIndex = new Map<number, string>();
  headerRow.eachCell((cell, idx) => {
    const label = String(cell.value ?? "").trim();
    const match = spec.columns.find(
      (c) => c.ar === label || c.key.toLowerCase() === label.toLowerCase(),
    );
    if (match) colByIndex.set(idx, match.key);
  });
  const missing = spec.columns
    .filter((c) => c.required && ![...colByIndex.values()].includes(c.key))
    .map((c) => c.ar);
  if (missing.length) {
    return NextResponse.json<ImportResult>(
      { error: "missingColumns:" + missing.join(", ") },
      { status: 400 },
    );
  }

  const records: Record<string, string>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const rec: Record<string, string> = {};
    let any = false;
    colByIndex.forEach((key, idx) => {
      const v = row.getCell(idx).value;
      const s =
        v instanceof Date
          ? v.toISOString().slice(0, 10)
          : v && typeof v === "object" && "result" in v
            ? String((v as { result: unknown }).result ?? "")
            : String(v ?? "").trim();
      if (s) any = true;
      rec[key] = s;
    });
    if (any) records.push({ ...rec, __row: String(n) });
  });

  const res = await importRows(spec.key, records);
  await writeAudit("System", `import-${table}`, "CREATE", {
    after: { created: res.created, skipped: res.skipped },
  });
  return NextResponse.json<ImportResult>({ ok: true, ...res });
}

const num = (v: string | undefined, d = 0) => {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : d;
};
const dateOf = (v: string | undefined): string | null => {
  const s = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

async function importRows(
  key: TableKey,
  rows: Record<string, string>[],
): Promise<{ created: number; skipped: number; errors: string[] }> {
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  const fail = (r: Record<string, string>, msg: string) => {
    skipped++;
    if (errors.length < 20) errors.push(`#${r.__row}: ${msg}`);
  };

  // Lookup caches shared across rows.
  const levels = await db.gradeLevel.findMany();
  const levelByCode = new Map(levels.map((l) => [l.code, l.id]));
  const levelByName = new Map(levels.map((l) => [l.nameAr, l.id]));
  const findLevel = (v?: string) =>
    levelByCode.get(String(v ?? "").trim()) ?? levelByName.get(String(v ?? "").trim()) ?? null;

  const students = await db.student.findMany({ select: { id: true, name: true, gradeLevelId: true } });
  const studentByName = new Map(students.map((s) => [s.name, s]));
  const teachers = await db.teacher.findMany({ select: { id: true, name: true } });
  const teacherByName = new Map(teachers.map((t) => [t.name, t.id]));
  const guardians = await db.guardian.findMany({ select: { id: true, name: true } });
  const guardianByName = new Map(guardians.map((g) => [g.name, g.id]));

  for (const r of rows) {
    try {
      switch (key) {
        case "students": {
          if (!r.name) { fail(r, "name required"); break; }
          if (studentByName.has(r.name)) { fail(r, "duplicate name"); break; }
          const s = await db.student.create({
            data: {
              name: r.name,
              phone: r.phone || null,
              gradeLevelId: findLevel(r.gradeCode),
              guardianId: r.guardianName ? guardianByName.get(r.guardianName) ?? null : null,
              address: r.address || null,
              checkinPin: /^\d{4,6}$/.test(r.checkinPin ?? "") ? r.checkinPin : null,
              notes: r.notes || null,
            },
          });
          studentByName.set(s.name, { id: s.id, name: s.name, gradeLevelId: s.gradeLevelId });
          created++;
          break;
        }
        case "teachers": {
          if (!r.name) { fail(r, "name required"); break; }
          if (teacherByName.has(r.name)) { fail(r, "duplicate name"); break; }
          const t = await db.teacher.create({
            data: {
              name: r.name,
              phone: r.phone || null,
              commissionPct: num(r.commissionPct, 50),
              fixedSalary: num(r.fixedSalary),
              fixedDeductions: num(r.fixedDeductions),
              notes: r.notes || null,
            },
          });
          teacherByName.set(t.name, t.id);
          created++;
          break;
        }
        case "guardians": {
          if (!r.name) { fail(r, "name required"); break; }
          if (guardianByName.has(r.name)) { fail(r, "duplicate name"); break; }
          const g = await db.guardian.create({
            data: {
              name: r.name,
              phone: r.phone || null,
              email: r.email || null,
              notes: r.notes || null,
            },
          });
          guardianByName.set(g.name, g.id);
          created++;
          break;
        }
        case "sessions": {
          const date = dateOf(r.date);
          const student = studentByName.get(r.studentName ?? "");
          const teacherId = teacherByName.get(r.teacherName ?? "");
          if (!date) { fail(r, "invalid date"); break; }
          if (!student) { fail(r, `unknown student: ${r.studentName}`); break; }
          if (!teacherId) { fail(r, `unknown teacher: ${r.teacherName}`); break; }
          const gradeLevelId = findLevel(r.gradeCode) ?? student.gradeLevelId;
          if (!gradeLevelId) { fail(r, "no grade level"); break; }
          const location = String(r.location ?? "").toUpperCase() === "HOME" ? "HOME" : "CENTER";
          const hours = num(r.hours, 1);
          const when = combineDateTime(date, /^\d{2}:\d{2}$/.test(r.time ?? "") ? r.time : null);
          const price = await resolvePricePerHour(gradeLevelId, location, when);
          await db.session.create({
            data: {
              date: when,
              studentId: student.id,
              teacherId,
              gradeLevelId,
              location,
              hours,
              pricePerHour: price,
              total: price * hours,
              status: ["DRAFT", "SCHEDULED", "CHECKED_IN", "COMPLETED", "NO_SHOW", "CANCELLED"]
                .includes(String(r.status ?? "").toUpperCase())
                ? String(r.status).toUpperCase()
                : "COMPLETED",
              paymentStatus: ["PAID", "PARTIAL", "UNPAID"].includes(String(r.paymentStatus ?? "").toUpperCase())
                ? String(r.paymentStatus).toUpperCase()
                : "UNPAID",
            },
          });
          created++;
          break;
        }
        case "payments": {
          const date = dateOf(r.date);
          if (!date) { fail(r, "invalid date"); break; }
          const amount = num(r.amount);
          if (amount <= 0) { fail(r, "invalid amount"); break; }
          let receiptNo = r.receiptNo?.trim();
          if (!receiptNo || (await db.payment.findUnique({ where: { receiptNo } }))) {
            const all = await db.payment.findMany({ select: { receiptNo: true } });
            receiptNo = String(
              Math.max(1000, ...all.map((p) => parseInt(p.receiptNo, 10) || 0)) + 1,
            );
          }
          await db.payment.create({
            data: {
              date: combineDateTime(date, null),
              receiptNo,
              studentId: studentByName.get(r.studentName ?? "")?.id ?? null,
              teacherId: teacherByName.get(r.teacherName ?? "") ?? null,
              amount,
              method: ["CASH", "POS", "QPAY", "TRANSFER"].includes(String(r.method ?? "").toUpperCase())
                ? String(r.method).toUpperCase()
                : "CASH",
              notes: r.notes || null,
            },
          });
          created++;
          break;
        }
        case "packages": {
          const student = studentByName.get(r.studentName ?? "");
          if (!student) { fail(r, `unknown student: ${r.studentName}`); break; }
          const totalHours = num(r.totalHours);
          if (totalHours <= 0) { fail(r, "invalid totalHours"); break; }
          const purchased = dateOf(r.purchasedAt);
          const expires = dateOf(r.expiresAt);
          await db.package.create({
            data: {
              studentId: student.id,
              totalHours,
              hoursUsed: num(r.hoursUsed),
              price: num(r.price),
              purchasedAt: purchased ? combineDateTime(purchased, null) : new Date(),
              expiresAt: expires ? combineDateTime(expires, null) : null,
              status: "ACTIVE",
            },
          });
          created++;
          break;
        }
        case "expenses": {
          const date = dateOf(r.date);
          if (!date) { fail(r, "invalid date"); break; }
          const amount = num(r.amount);
          if (amount <= 0) { fail(r, "invalid amount"); break; }
          let cat = await db.expenseCategory.findFirst({ where: { nameAr: r.categoryAr } });
          if (!cat) {
            cat = await db.expenseCategory.create({
              data: { nameAr: r.categoryAr, nameEn: r.categoryAr, sortOrder: 99 },
            });
          }
          await db.expense.create({
            data: {
              date: combineDateTime(date, null),
              description: r.description,
              categoryId: cat.id,
              amount,
              paidTo: r.paidTo || null,
            },
          });
          created++;
          break;
        }
        default:
          fail(r, "table not importable");
      }
    } catch (e) {
      fail(r, e instanceof Error ? e.message.slice(0, 120) : "error");
    }
  }

  return { created, skipped, errors };
}
