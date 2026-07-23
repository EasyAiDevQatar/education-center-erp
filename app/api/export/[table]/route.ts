import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES, FINANCE_ROLES } from "@/lib/rbac";
import { toNumber } from "@/lib/money";
import { TABLES, type TableKey } from "@/lib/data-zone";
import { readSessionFilters, sessionWhere, type SessionFilters } from "@/lib/session-query";

/**
 * Generic XLSX export: /api/export/<table>[?template=1]
 * `template=1` returns just the header row — the import template.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ table: string }> },
) {
  const session = await getSession();
  if (!session || !STAFF_ROLES.includes(session.role)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { table } = await ctx.params;
  const spec = TABLES.find((t) => t.key === table);
  if (!spec) return new NextResponse("Unknown table", { status: 404 });
  if (spec.finance && !FINANCE_ROLES.includes(session.role)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const templateOnly = url.searchParams.get("template") === "1";
  // Sessions honour the list page's filters so "export" matches what's on screen.
  const filters = readSessionFilters(Object.fromEntries(url.searchParams.entries()));
  const rows = templateOnly ? [] : await loadRows(spec.key, filters);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Education Center ERP";
  const ws = wb.addWorksheet(table);
  ws.views = [{ rightToLeft: true }];

  ws.columns = spec.columns.map((c) => ({
    header: c.ar,
    key: c.key,
    width: Math.max(14, c.ar.length + 6),
  }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFEFF6F7" },
  };
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: spec.columns.length },
  };
  for (const r of rows) ws.addRow(r);

  const buf = await wb.xlsx.writeBuffer();
  const suffix = templateOnly ? "template" : new Date().toISOString().slice(0, 10);
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${table}-${suffix}.xlsx"`,
    },
  });
}

const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const hm = (d: Date) => d.toISOString().slice(11, 16);

async function loadRows(
  key: TableKey,
  filters: SessionFilters,
): Promise<Record<string, unknown>[]> {
  switch (key) {
    case "students": {
      const rows = await db.student.findMany({
        include: { gradeLevel: true, guardian: true },
        orderBy: { name: "asc" },
      });
      return rows.map((s) => ({
        name: s.name,
        nameEn: s.nameEn ?? "",
        phone: s.phone ?? "",
        gradeCode: s.gradeLevel?.code ?? "",
        studyLocation: s.studyLocation,
        guardianName: s.guardian?.name ?? "",
        address: s.address ?? "",
        homeCode: s.homeCode ?? "",
        checkinPin: s.checkinPin ?? "",
        notes: s.notes ?? "",
      }));
    }
    case "accounts": {
      const rows = await db.account.findMany({
        orderBy: { code: "asc" },
        include: { parent: { select: { code: true } } },
      });
      return rows.map((a) => ({
        code: a.code,
        nameAr: a.nameAr,
        nameEn: a.nameEn,
        type: a.type,
        parentCode: a.parent?.code ?? "",
        active: a.active ? "1" : "0",
      }));
    }
    case "suppliers": {
      const rows = await db.supplier.findMany({ orderBy: { name: "asc" } });
      return rows.map((s) => ({
        name: s.name,
        nameEn: s.nameEn ?? "",
        phone: s.phone ?? "",
        email: s.email ?? "",
        taxNo: s.taxNo ?? "",
        address: s.address ?? "",
        notes: s.notes ?? "",
      }));
    }
    case "journal": {
      const rows = await db.journalLine.findMany({
        include: {
          entry: { select: { date: true, memo: true, sourceType: true } },
          account: { select: { code: true, nameAr: true } },
        },
        orderBy: { entry: { date: "desc" } },
        take: 20000,
      });
      return rows.map((l) => ({
        date: ymd(l.entry.date),
        memo: l.entry.memo,
        source: l.entry.sourceType,
        accountCode: l.account.code,
        accountName: l.account.nameAr,
        debit: toNumber(l.debit),
        credit: toNumber(l.credit),
      }));
    }
    case "teachers": {
      const rows = await db.teacher.findMany({ orderBy: { name: "asc" } });
      return rows.map((t) => ({
        name: t.name,
        nameEn: t.nameEn ?? "",
        phone: t.phone ?? "",
        commissionPct: toNumber(t.commissionPct),
        fixedSalary: toNumber(t.fixedSalary),
        fixedDeductions: toNumber(t.fixedDeductions),
        notes: t.notes ?? "",
      }));
    }
    case "guardians": {
      const rows = await db.guardian.findMany({ orderBy: { name: "asc" } });
      return rows.map((g) => ({
        name: g.name,
        nameEn: g.nameEn ?? "",
        phone: g.phone ?? "",
        email: g.email ?? "",
        notes: g.notes ?? "",
      }));
    }
    case "sessions": {
      const rows = await db.session.findMany({
        where: sessionWhere(filters),
        include: { student: true, teacher: true, gradeLevel: true },
        orderBy: { date: "desc" },
        take: 10000,
      });
      return rows.map((s) => ({
        date: ymd(s.date),
        time: hm(s.date),
        studentName: s.student.name,
        teacherName: s.teacher?.name ?? "",
        gradeCode: s.gradeLevel.code,
        location: s.location,
        hours: toNumber(s.hours),
        status: s.status,
        paymentStatus: s.paymentStatus,
      }));
    }
    case "payments": {
      const rows = await db.payment.findMany({
        include: { student: true, teacher: true },
        orderBy: { date: "desc" },
        take: 10000,
      });
      return rows.map((p) => ({
        date: ymd(p.date),
        receiptNo: p.receiptNo,
        studentName: p.student?.name ?? "",
        teacherName: p.teacher?.name ?? "",
        amount: toNumber(p.amount),
        method: p.method,
        notes: p.notes ?? "",
      }));
    }
    case "packages": {
      const rows = await db.package.findMany({
        include: { student: true },
        orderBy: { purchasedAt: "desc" },
      });
      return rows.map((p) => ({
        studentName: p.student.name,
        totalHours: toNumber(p.totalHours),
        hoursUsed: toNumber(p.hoursUsed),
        price: toNumber(p.price),
        purchasedAt: ymd(p.purchasedAt),
        expiresAt: ymd(p.expiresAt),
      }));
    }
    case "expenses": {
      const rows = await db.expense.findMany({
        include: { category: true },
        orderBy: { date: "desc" },
        take: 10000,
      });
      return rows.map((e) => ({
        date: ymd(e.date),
        description: e.description,
        categoryAr: e.category.nameAr,
        amount: toNumber(e.amount),
        paidTo: e.paidTo ?? "",
      }));
    }
    case "payouts": {
      const rows = await db.teacherPayout.findMany({
        include: { teacher: true },
        orderBy: { periodStart: "desc" },
      });
      return rows.map((p) => ({
        teacherName: p.teacher?.name ?? "",
        periodStart: ymd(p.periodStart),
        periodEnd: ymd(p.periodEnd),
        grossCommission: toNumber(p.grossCommission),
        fixedSalary: toNumber(p.fixedSalary),
        deductions: toNumber(p.deductions),
        advances: toNumber(p.advances),
        netPaid: toNumber(p.netPaid),
        status: p.status,
      }));
    }
    case "leads": {
      const rows = await db.lead.findMany({
        include: { gradeLevel: true },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((l) => ({
        name: l.name,
        nameEn: l.nameEn ?? "",
        phone: l.phone,
        email: l.email,
        source: l.source,
        status: l.status,
        gradeCode: l.gradeLevel?.code ?? null,
        followUpAt: l.followUpAt ? ymd(l.followUpAt) : null,
        notes: l.notes,
      }));
    }
    case "terms": {
      const rows = await db.term.findMany({ orderBy: { startDate: "desc" } });
      return rows.map((x) => ({
        nameAr: x.nameAr,
        nameEn: x.nameEn,
        startDate: ymd(x.startDate),
        endDate: ymd(x.endDate),
      }));
    }
  }
}
