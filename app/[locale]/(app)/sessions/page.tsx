import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireRole, ACADEMIC_ROLES } from "@/lib/rbac";
import { db } from "@/lib/db";
import { loadGroupOpts } from "@/lib/groups";
import { toNumber } from "@/lib/money";
import { loadSessionFormOptions } from "@/lib/session-form-options";
import { readSessionFilters, sessionWhere } from "@/lib/session-query";
import { PageHeader } from "@/components/page-header";
import { SessionsClient, type SessionRow } from "./sessions-client";
import { displayName } from "@/lib/names";
import { unchargeableStatuses } from "@/lib/billing";
import { groupOccurrenceKeys, sessionOccurrenceKey } from "@/lib/session-grouping";

export default async function SessionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(locale, ACADEMIC_ROLES);

  const t = await getTranslations("sessions");
  const sp = await searchParams;
  const filters = readSessionFilters(sp);
  const unchargeable = await unchargeableStatuses();

  const [sessions, formOptions, groups] =
    await Promise.all([
      db.session.findMany({
        where: sessionWhere(filters),
        orderBy: { date: "desc" },
        take: 500,
        include: {
          student: true,
          teacher: true,
          gradeLevel: true,
          subject: true,
          group: { select: { name: true } },
        },
      }),
      loadSessionFormOptions(locale),
      loadGroupOpts(),
    ]);

  const {
    students: studentOpts,
    teachers: teacherOpts,
    levels: levelOpts,
    matrix: matrixMap,
    currency,
    packages: packageOpts,
    subjects: subjectOpts,
    teacherSubjectIds,
  } = formOptions;
  const label = (ar: string, en: string) => (locale === "ar" ? ar : en);

  const realGroupKeys = groupOccurrenceKeys(sessions);
  const allRows: SessionRow[] = sessions.map((s) => {
    const occurrenceKey = sessionOccurrenceKey(s);
    return {
      id: s.id,
      referenceNo: s.referenceNo,
      date: s.date.toISOString().slice(0, 10),
      time: s.date.toISOString().slice(11, 16),
      studentId: s.studentId,
      teacherId: s.teacherId ?? "",
      gradeLevelId: s.gradeLevelId,
      subjectId: s.subjectId,
      subjectLabel: s.subject ? label(s.subject.nameAr, s.subject.nameEn) : null,
      location: s.location as "CENTER" | "HOME",
      hours: toNumber(s.hours),
      status: s.status,
      chargeable: !unchargeable.includes(s.status),
      paymentStatus: s.paymentStatus,
      notes: s.notes,
      studentName: displayName(s.student, locale),
      teacherName: s.teacher ? displayName(s.teacher, locale) : "",
      levelLabel: label(s.gradeLevel.nameAr, s.gradeLevel.nameEn),
      pricePerHour: toNumber(s.pricePerHour),
      total: toNumber(s.total),
      groupKey: realGroupKeys.has(occurrenceKey) ? occurrenceKey : null,
      groupName: s.group?.name ?? null,
    };
  });
  const rows = filters.bookingType === "group"
    ? allRows.filter((row) => row.groupKey)
    : filters.bookingType === "individual"
      ? allRows.filter((row) => !row.groupKey)
      : allRows;

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
        groups={groups}
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
