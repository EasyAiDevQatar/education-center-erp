import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { currentPriceMatrix } from "@/lib/pricing";
import { readSessionFilters, sessionWhere } from "@/lib/session-query";
import { PageHeader } from "@/components/page-header";
import { SessionsClient, type SessionRow } from "./sessions-client";
import type { PriceMatrix } from "./session-dialog";

export default async function SessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, STAFF_ROLES);

  const t = await getTranslations("sessions");
  const sp = await searchParams;
  const filters = readSessionFilters(sp);

  const [sessions, students, teachers, levels, matrix, settingsRows] =
    await Promise.all([
      db.session.findMany({
        where: sessionWhere(filters),
        orderBy: { date: "desc" },
        take: 500,
        include: { student: true, teacher: true, gradeLevel: true },
      }),
      db.student.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      db.teacher.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      db.gradeLevel.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
      currentPriceMatrix(),
      db.setting.findMany({ where: { key: "currency" } }),
    ]);

  const currency = settingsRows[0]?.value ?? "QAR";
  const label = (ar: string, en: string) => (locale === "ar" ? ar : en);

  const matrixMap: PriceMatrix = Object.fromEntries(
    matrix.map((m) => [m.gradeLevel.id, { CENTER: m.CENTER, HOME: m.HOME }]),
  );

  const rows: SessionRow[] = sessions.map((s) => ({
    id: s.id,
    date: s.date.toISOString().slice(0, 10),
    time: s.date.toISOString().slice(11, 16),
    studentId: s.studentId,
    teacherId: s.teacherId,
    gradeLevelId: s.gradeLevelId,
    location: s.location as "CENTER" | "HOME",
    hours: toNumber(s.hours),
    paymentStatus: s.paymentStatus,
    notes: s.notes,
    studentName: s.student.name,
    teacherName: s.teacher.name,
    levelLabel: label(s.gradeLevel.nameAr, s.gradeLevel.nameEn),
    pricePerHour: toNumber(s.pricePerHour),
    total: toNumber(s.total),
  }));

  const studentOpts = students.map((s) => ({
    id: s.id,
    name: s.name,
    gradeLevelId: s.gradeLevelId,
  }));
  const teacherOpts = teachers.map((tt) => ({ id: tt.id, label: tt.name }));
  const levelOpts = levels.map((l) => ({ id: l.id, label: label(l.nameAr, l.nameEn) }));

  // Export link carries the current filters.
  const exportParams = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) exportParams.set(k, v);
  const exportHref = `/api/export/sessions?${exportParams.toString()}`;

  return (
    <div>
      <PageHeader title={t("title")} />
      <SessionsClient
        sessions={rows}
        students={studentOpts}
        teachers={teacherOpts}
        levels={levelOpts}
        matrix={matrixMap}
        currency={currency}
        filters={filters}
        exportHref={exportHref}
      />
    </div>
  );
}
