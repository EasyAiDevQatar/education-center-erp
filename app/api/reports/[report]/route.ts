import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { FINANCE_ROLES } from "@/lib/rbac";
import {
  getAttendance,
  getRevenueBreakdown,
  getCollectionsByMethod,
  getPackageReport,
  getPayoutSummary,
  getTopDebtors,
} from "@/lib/report-queries";

/** XLSX export of a report: /api/reports/<report>?by=&from=&to=&term= */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ report: string }> },
) {
  const session = await getSession();
  if (!session || !FINANCE_ROLES.includes(session.role)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { report } = await ctx.params;
  const url = new URL(request.url);
  const by = url.searchParams.get("by") ?? "";
  const termId = url.searchParams.get("term") ?? "";

  // Mirror the page: a term overrides the loose date inputs.
  const term = termId ? await db.term.findUnique({ where: { id: termId } }) : null;
  const fromStr = term
    ? term.startDate.toISOString().slice(0, 10)
    : url.searchParams.get("from") ?? "";
  const toStr = term
    ? term.endDate.toISOString().slice(0, 10)
    : url.searchParams.get("to") ?? "";
  const range = {
    from: fromStr ? new Date(`${fromStr}T00:00:00.000Z`) : undefined,
    to: toStr ? new Date(`${toStr}T23:59:59.999Z`) : undefined,
  };

  const locale = url.searchParams.get("locale") ?? "ar";

  let header: string[] = [];
  let rows: (string | number | null)[][] = [];

  switch (report) {
    case "attendance": {
      const data = await getAttendance(by === "student" ? "student" : "teacher", range);
      header = ["الاسم", "الحصص", "مكتملة", "غياب", "ملغاة", "الساعات", "نسبة الحضور %"];
      rows = data.map((r) => [r.name, r.total, r.completed, r.noShow, r.cancelled, r.hours, r.attendanceRate]);
      break;
    }
    case "revenue": {
      const data = await getRevenueBreakdown(
        by === "level" || by === "location" ? by : "teacher",
        range,
        locale,
      );
      header = ["البند", "الحصص", "الساعات", "الدخل المتوقع"];
      rows = data.map((r) => [r.label, r.sessions, r.hours, r.expected]);
      break;
    }
    case "collections": {
      const data = await getCollectionsByMethod(range);
      header = ["طريقة الدفع", "عدد المدفوعات", "المبلغ", "النسبة %"];
      rows = data.map((r) => [r.method, r.count, r.total, r.pct]);
      break;
    }
    case "packages": {
      const data = await getPackageReport(range);
      header = ["الطالب", "إجمالي الساعات", "المستخدمة", "المتبقية", "السعر", "الحالة", "تاريخ الانتهاء"];
      rows = data.map((r) => [
        r.studentName, r.totalHours, r.hoursUsed, r.remaining, r.price, r.status, r.expiresAt,
      ]);
      break;
    }
    case "payroll": {
      const data = await getPayoutSummary(range);
      header = ["المعلم", "طريقة الدفع", "من", "إلى", "العمولة", "الراتب الثابت", "الخصومات", "السلف", "الصافي", "الحالة"];
      rows = data.map((r) => [
        r.teacherName, r.payMode, r.periodStart, r.periodEnd,
        r.grossCommission, r.fixedSalary, r.deductions, r.advances, r.netPaid, r.status,
      ]);
      break;
    }
    case "debtors": {
      const data = await getTopDebtors(1000);
      header = ["الطالب", "ولي الأمر", "الهاتف", "الرسوم", "المدفوع", "الرصيد"];
      rows = data.map((r) => [r.name, r.guardianName, r.phone, r.charges, r.paid, r.balance]);
      break;
    }
    default:
      return new NextResponse("Unknown report", { status: 404 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Education Center ERP";
  const ws = wb.addWorksheet(report);
  ws.views = [{ rightToLeft: true }];

  // A period line above the table, so a printed/emailed file is self-describing.
  ws.addRow([`${fromStr || "—"} → ${toStr || "—"}`]);
  ws.addRow([]);
  const headerRow = ws.addRow(header);
  headerRow.font = { bold: true };
  for (const r of rows) ws.addRow(r);
  ws.columns.forEach((c) => {
    c.width = 18;
  });

  const buf = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${report}-${stamp}.xlsx"`,
    },
  });
}
