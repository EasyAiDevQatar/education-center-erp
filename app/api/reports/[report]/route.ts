import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { FINANCE_ROLES } from "@/lib/rbac";
import { moduleEnabled } from "@/lib/modules";
import { resolveReportDateStrings } from "@/lib/report-range";
import {
  getDailySessionReport,
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
  if (!(await moduleEnabled("reports"))) {
    return new NextResponse("Reports module disabled", { status: 403 });
  }

  const { report } = await ctx.params;
  const url = new URL(request.url);
  const by = url.searchParams.get("by") ?? "";
  const termId = url.searchParams.get("term") ?? "";

  // Mirror the page: a term overrides the loose date inputs.
  const term = termId ? await db.term.findUnique({ where: { id: termId } }) : null;
  const { from: fromStr, to: toStr } = resolveReportDateStrings({
    report,
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    termFrom: term?.startDate.toISOString().slice(0, 10),
    termTo: term?.endDate.toISOString().slice(0, 10),
  });
  const range = {
    from: fromStr ? new Date(`${fromStr}T00:00:00.000Z`) : undefined,
    to: toStr ? new Date(`${toStr}T23:59:59.999Z`) : undefined,
  };

  const locale = url.searchParams.get("locale") === "en" ? "en" : "ar";
  const en = locale === "en";

  let header: string[] = [];
  let rows: (string | number | null)[][] = [];

  switch (report) {
    case "daily-sessions": {
      const data = await getDailySessionReport(range);
      header = en
        ? ["Date", "Teaching sessions", "Group sessions", "Individual sessions", "Student bookings", "Scheduled", "In progress", "Completed", "No-show", "Cancelled sessions", "Cancelled student bookings"]
        : ["التاريخ", "الحصص التعليمية", "الحصص الجماعية", "الحصص الفردية", "حجوزات الطلاب", "مجدولة", "قيد التنفيذ", "مكتملة", "غياب", "الحصص الملغاة", "حجوزات الطلاب الملغاة"];
      rows = data.dailyTrend.map((r) => [
        r.date, r.sessions, r.groupSessions, r.individualSessions, r.studentBookings,
        r.scheduled, r.checkedIn, r.completed, r.noShow, r.cancelled, r.cancelledStudentBookings,
      ]);
      break;
    }
    case "attendance": {
      const data = await getAttendance(by === "student" ? "student" : "teacher", range);
      header = en
        ? ["Name", "Sessions", "Completed", "No-show", "Cancelled", "Hours", "Attendance rate %"]
        : ["الاسم", "الحصص", "مكتملة", "غياب", "ملغاة", "الساعات", "نسبة الحضور %"];
      rows = data.map((r) => [r.name, r.total, r.completed, r.noShow, r.cancelled, r.hours, r.attendanceRate]);
      break;
    }
    case "revenue": {
      const data = await getRevenueBreakdown(
        by === "level" || by === "location" ? by : "teacher",
        range,
        locale,
      );
      header = en
        ? ["Item", "Sessions", "Hours", "Expected revenue"]
        : ["البند", "الحصص", "الساعات", "الدخل المتوقع"];
      rows = data.map((r) => [r.label, r.sessions, r.hours, r.expected]);
      break;
    }
    case "collections": {
      const data = await getCollectionsByMethod(range);
      header = en
        ? ["Payment method", "Payments", "Refunds", "Gross collected", "Refunded", "Net collected", "Share %"]
        : ["طريقة الدفع", "عدد المدفوعات", "عدد المرتجعات", "إجمالي المحصل", "المرتجع", "صافي المحصل", "النسبة %"];
      rows = data.map((r) => [
        r.method, r.count, r.refundCount, r.gross, r.refunded, r.total, r.pct,
      ]);
      break;
    }
    case "packages": {
      const data = await getPackageReport(range);
      header = en
        ? ["Student", "Total hours", "Used", "Remaining", "Price", "Status", "Expires"]
        : ["الطالب", "إجمالي الساعات", "المستخدمة", "المتبقية", "السعر", "الحالة", "تاريخ الانتهاء"];
      rows = data.map((r) => [
        r.studentName, r.totalHours, r.hoursUsed, r.remaining, r.price, r.status, r.expiresAt,
      ]);
      break;
    }
    case "payroll": {
      const data = await getPayoutSummary(range);
      header = en
        ? ["Teacher", "Pay mode", "From", "To", "Commission", "Fixed salary", "Deductions", "Advances", "Net paid", "Status"]
        : ["المعلم", "طريقة الدفع", "من", "إلى", "العمولة", "الراتب الثابت", "الخصومات", "السلف", "الصافي", "الحالة"];
      rows = data.map((r) => [
        r.teacherName, r.payMode, r.periodStart, r.periodEnd,
        r.grossCommission, r.fixedSalary, r.deductions, r.advances, r.netPaid, r.status,
      ]);
      break;
    }
    case "debtors": {
      const data = await getTopDebtors(1000);
      header = en
        ? ["Student", "Guardian", "Phone", "Charges", "Paid", "Balance"]
        : ["الطالب", "ولي الأمر", "الهاتف", "الرسوم", "المدفوع", "الرصيد"];
      rows = data.map((r) => [r.name, r.guardianName, r.phone, r.charges, r.paid, r.balance]);
      break;
    }
    default:
      return new NextResponse("Unknown report", { status: 404 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Education Center ERP";
  const ws = wb.addWorksheet(report);
  ws.views = [{ rightToLeft: !en }];

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
