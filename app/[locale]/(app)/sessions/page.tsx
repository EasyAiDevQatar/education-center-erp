import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, STAFF_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { currentPriceMatrix } from "@/lib/pricing";
import { readSessionFilters, sessionWhere } from "@/lib/session-query";
import { PageHeader } from "@/components/page-header";
import { SessionsClient, type SessionRow } from "./sessions-client";
import type { PriceMatrix } from "./session-dialog";
import { displayName } from "@/lib/names";

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

  // Assignments are per academic year; unscoped until a year exists.
  const currentYear = await db.academicYear.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });

  const [sessions, students, teachers, levels, matrix, settingsRows, activePackages, subjectList, teacherSubjectRows] =
    await Promise.all([
      db.session.findMany({
        where: sessionWhere(filters),
        orderBy: { date: "desc" },
        take: 500,
        include: { student: true, teacher: true, gradeLevel: true, subject: true },
      }),
      db.student.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      include: { teachers: { where: { academicYearId: currentYear?.id ?? null } } },
    }),
      db.teacher.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      db.gradeLevel.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
      currentPriceMatrix(),
      db.setting.findMany({ where: { key: "currency" } }),
      db.package.findMany({
        where: { status: "ACTIVE" },
        include: { student: true },
        orderBy: { purchasedAt: "desc" },
      }),
      db.subject.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { nameAr: "asc" }],
      }),
      db.teacherSubject.findMany({ select: { teacherId: true, subjectId: true } }),
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
    teacherId: s.teacherId ?? "",
    gradeLevelId: s.gradeLevelId,
    subjectId: s.subjectId,
    subjectLabel: s.subject ? label(s.subject.nameAr, s.subject.nameEn) : null,
    location: s.location as "CENTER" | "HOME",
    hours: toNumber(s.hours),
    paymentStatus: s.paymentStatus,
    notes: s.notes,
    studentName: displayName(s.student, locale),
    teacherName: s.teacher ? displayName(s.teacher, locale) : "",
    levelLabel: label(s.gradeLevel.nameAr, s.gradeLevel.nameEn),
    pricePerHour: toNumber(s.pricePerHour),
    total: toNumber(s.total),
  }));

  const studentOpts = students.map((s) => ({
    id: s.id,
    name: displayName(s, locale),
    teacherIds: s.teachers.map((x) => x.teacherId),
    gradeLevelId: s.gradeLevelId,
    studyLocation: s.studyLocation as "CENTER" | "HOME",
  }));
  const packageOpts = activePackages.map((p) => ({
    id: p.id,
    studentId: p.studentId,
    label: `${toNumber(p.totalHours) - toNumber(p.hoursUsed)} / ${toNumber(p.totalHours)} ${
      locale === "ar" ? "ساعة متبقية" : "h remaining"
    }`,
  }));
  const teacherOpts = teachers.map((tt) => ({ id: tt.id, label: displayName(tt, locale) }));
  const subjectOpts = subjectList.map((sbj) => ({ id: sbj.id, label: label(sbj.nameAr, sbj.nameEn) }));
  const teacherSubjectIds: Record<string, string[]> = {};
  for (const r of teacherSubjectRows) {
    (teacherSubjectIds[r.teacherId] ??= []).push(r.subjectId);
  }
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
        packages={packageOpts}
        subjects={subjectOpts}
        teacherSubjectIds={teacherSubjectIds}
        filters={filters}
        exportHref={exportHref}
      />
    </div>
  );
}
