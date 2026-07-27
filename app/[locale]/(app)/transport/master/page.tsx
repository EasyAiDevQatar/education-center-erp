import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { displayName } from "@/lib/names";
import { currentPriceMatrix } from "@/lib/pricing";
import type { PriceMatrix } from "../../sessions/session-dialog";
import { requireTransport } from "@/lib/transport/guard";
import { ACADEMIC_ROLES } from "@/lib/rbac";
import { masterBoard, type LaneKind } from "@/lib/transport/master";
import { PageHeader } from "@/components/page-header";
import { MasterClient } from "./master-client";

/**
 * The master planner: one row per person, showing their WHOLE day.
 *
 * The dispatch board draws rides and nothing else, which is why a teacher who
 * taught continuously between two trips looked like she idled for six hours.
 * Here a row carries lessons, travel and the gaps between them, so a blank
 * stretch means something rather than hiding something.
 */
export default async function TransportMasterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const auth = await requireTransport(locale);

  // Who may move a lesson. The page guard already limits this screen to staff;
  // this narrows further to the roles that actually schedule. An accountant
  // reads the day, they do not re-time it. Enforced again on the save path in
  // the next step — this only decides what the board offers.
  const canDrag = (ACADEMIC_ROLES as readonly string[]).includes(auth.role);
  const t = await getTranslations("transportMaster");

  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]) as string | undefined;

  const dParam = one("date");
  const day =
    dParam && /^\d{4}-\d{2}-\d{2}$/.test(dParam)
      ? dParam
      : new Date().toISOString().slice(0, 10);

  // The perspective changes what a ROW is, so unlike the layer toggles it has
  // to be re-read from the server.
  const viewParam = one("view");
  const laneKind: LaneKind =
    viewParam === "DRIVER" || viewParam === "VEHICLE" ? viewParam : "TEACHER";

  // Everything else is loaded; which layers are drawn is the client's
  // business, so a toggle is instant and a hidden centre lesson still marks
  // the row busy.
  const board = await masterBoard(locale, day, { laneKind, canDrag });

  // What the booking dialog needs to exist. Loaded only for someone who can
  // actually create a lesson — a viewer never opens it, so a viewer never pays
  // for the roster.
  const year = canDrag
    ? await db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } })
    : null;
  const [students, teachers, levels, matrix, settingsRows, subjectList, teacherSubjectRows] =
    canDrag
      ? await Promise.all([
          db.student.findMany({
            where: { active: true },
            orderBy: { name: "asc" },
            include: { teachers: { where: { academicYearId: year?.id ?? null } } },
          }),
          db.teacher.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
          db.gradeLevel.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
          currentPriceMatrix(),
          db.setting.findMany({ where: { key: { in: ["currency"] } } }),
          db.subject.findMany({
            where: { active: true },
            orderBy: [{ sortOrder: "asc" }, { nameAr: "asc" }],
          }),
          db.teacherSubject.findMany({ select: { teacherId: true, subjectId: true } }),
        ])
      : [[], [], [], [], [], [], []];

  const label = (ar: string, en: string | null) => (locale === "en" && en ? en : ar);
  const booking = canDrag
    ? {
        currency:
          Object.fromEntries(settingsRows.map((r) => [r.key, r.value])).currency ?? "QAR",
        students: students.map((st) => ({
          id: st.id,
          name: displayName(st, locale),
          gradeLevelId: st.gradeLevelId,
          gradeYear: st.gradeYear,
          teacherIds: st.teachers.map((x) => x.teacherId),
          studyLocation: st.studyLocation as "CENTER" | "HOME",
        })),
        teachers: teachers.map((tt) => ({ id: tt.id, label: displayName(tt, locale) })),
        levels: levels.map((l) => ({ id: l.id, label: label(l.nameAr, l.nameEn) })),
        matrix: Object.fromEntries(
          matrix.map((m) => [m.gradeLevel.id, { CENTER: m.CENTER, HOME: m.HOME }]),
        ) as PriceMatrix,
        subjects: subjectList.map((x) => ({ id: x.id, label: label(x.nameAr, x.nameEn) })),
        teacherSubjectIds: teacherSubjectRows.reduce<Record<string, string[]>>((acc, r) => {
          (acc[r.teacherId] ??= []).push(r.subjectId);
          return acc;
        }, {}),
      }
    : null;

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <MasterClient board={board} booking={booking} />
    </div>
  );
}
