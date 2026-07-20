import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { toNumber } from "@/lib/money";
import { readSessionFilters, sessionWhere } from "@/lib/session-query";

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !STAFF_ROLES.includes(session.role)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const sp = Object.fromEntries(url.searchParams.entries());
  const filters = readSessionFilters(sp);

  const sessions = await db.session.findMany({
    where: sessionWhere(filters),
    orderBy: { date: "desc" },
    include: { student: true, teacher: true, gradeLevel: true },
  });

  const header = [
    "التاريخ",
    "الطالب",
    "المعلم",
    "المرحلة",
    "المكان",
    "عدد الساعات",
    "سعر الساعة",
    "الإجمالي",
    "حالة الدفع",
  ];
  const locNames: Record<string, string> = { CENTER: "المركز", HOME: "المنزل" };
  const statusNames: Record<string, string> = {
    PAID: "مدفوع",
    PARTIAL: "جزئي",
    UNPAID: "غير مدفوع",
  };

  const lines = [header.map(csvCell).join(",")];
  for (const s of sessions) {
    lines.push(
      [
        s.date.toISOString().slice(0, 10),
        s.student.name,
        s.teacher.name,
        s.gradeLevel.nameAr,
        locNames[s.location] ?? s.location,
        toNumber(s.hours),
        toNumber(s.pricePerHour),
        toNumber(s.total),
        statusNames[s.paymentStatus] ?? s.paymentStatus,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  // UTF-8 BOM so Excel renders Arabic correctly.
  const body = "﻿" + lines.join("\r\n");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sessions-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
