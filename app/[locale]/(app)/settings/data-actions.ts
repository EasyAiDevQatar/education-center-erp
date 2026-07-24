"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { WIPE_PHRASE, SEED_SPEC, type SeedKey } from "@/lib/data-zone";
import { ensureLeaveTypes } from "@/lib/leave-data";
import { LEAD_STATUSES } from "@/lib/leads";
import { hashPassword } from "@/lib/password";
import { accountingEnabled, backfillJournal } from "@/lib/accounting/journal-data";

export type DataState = {
  ok?: boolean;
  error?: string;
  /** Set with error "seedRange": which count was out of range, and its cap. */
  field?: string;
  max?: number;
  summary?: Record<string, number>;
};

async function guardAdmin() {
  const s = await getSession();
  return !s || s.role !== "ADMIN" ? null : s;
}

/**
 * Danger zone: delete every business record. Kept: admin users (links cleared),
 * Settings (centre profile) and Integration configs. Reference data (grade
 * levels, price matrix, expense categories) is wiped too — the seeder restores it.
 */
export async function wipeAllData(locale: string, confirm: string): Promise<DataState> {
  const session = await guardAdmin();
  if (!session) return { error: "forbidden" };
  if (confirm !== WIPE_PHRASE) return { error: "confirmMismatch" };

  const summary: Record<string, number> = {};
  await db.$transaction(async (tx) => {
    summary.notificationLogs = (await tx.notificationLog.deleteMany()).count;
    summary.loginAttempts = (await tx.loginAttempt.deleteMany()).count;
    summary.auditLogs = (await tx.auditLog.deleteMany()).count;
    // Accounting: entries (lines cascade) before accounts; the accounts row
    // itself waits until after expenseCategories, which reference it. Cheques
    // reference payments/expenses/payouts, so they go before all of them.
    summary.journalEntries = (await tx.journalEntry.deleteMany()).count;
    summary.cheques = (await tx.cheque.deleteMany()).count;
    summary.chequeBooks = (await tx.chequeBook.deleteMany()).count;
    // HR: settlements and exports before their parents; payouts before runs.
    summary.endOfService = (await tx.endOfService.deleteMany()).count;
    summary.wpsExports = (await tx.wpsExport.deleteMany()).count;
    summary.payouts = (await tx.teacherPayout.deleteMany()).count;
    summary.payrollRuns = (await tx.payrollRun.deleteMany()).count;
    // Transport trips: stops and events cascade from the trip, but they are
    // deleted explicitly so the summary is honest. Trips go before sessions,
    // drivers and vehicles — everything a stop or a trip points at.
    summary.tripEvents = (await tx.tripEvent.deleteMany()).count;
    summary.tripStops = (await tx.tripStop.deleteMany()).count;
    summary.trips = (await tx.trip.deleteMany()).count;
    summary.payments = (await tx.payment.deleteMany()).count;
    summary.sessions = (await tx.session.deleteMany()).count;
    // Leads are business records and must go too. Their links to student /
    // gradeLevel / user are all optional, so Prisma made them ON DELETE SET
    // NULL — without this line a wipe would silently leave every lead behind
    // with its references nulled, which is not "delete every business record".
    // Sessions are deleted first because they point at leads, not vice versa.
    summary.leads = (await tx.lead.deleteMany()).count;
    // These two cascade from Teacher, so they would go anyway; deleting them
    // explicitly keeps the returned summary honest about what was removed.
    summary.plannerTemplates = (await tx.plannerTemplate.deleteMany()).count;
    summary.availability = (await tx.teacherAvailability.deleteMany()).count;
    summary.packages = (await tx.package.deleteMany()).count;
    summary.expenses = (await tx.expense.deleteMany()).count;
    summary.suppliers = (await tx.supplier.deleteMany()).count;
    summary.expenseCategories = (await tx.expenseCategory.deleteMany()).count;
    summary.accounts = (await tx.account.deleteMany()).count;
    summary.priceRules = (await tx.priceRule.deleteMany()).count;
    // Non-admin accounts go; remaining admins lose teacher/guardian links.
    summary.users = (await tx.user.deleteMany({ where: { role: { not: "ADMIN" } } })).count;
    await tx.user.updateMany({ data: { teacherId: null, guardianId: null } });
    // Groups ("courses") reference students (Cascade) and teachers/subjects/
    // grades (SetNull); clear members then the groups before students go.
    summary.groupMembers = (await tx.groupMember.deleteMany()).count;
    summary.studentGroups = (await tx.studentGroup.deleteMany()).count;
    summary.students = (await tx.student.deleteMany()).count;
    summary.guardians = (await tx.guardian.deleteMany()).count;
    // Transport, innermost first. Fleet cost logs point at vehicles, suppliers
    // and expenses, so they lead; their linked expenses were already removed by
    // the expense sweep above — deleting a log never deletes money on its own.
    summary.fuelLogs = (await tx.fuelLog.deleteMany()).count;
    summary.maintenanceLogs = (await tx.maintenanceLog.deleteMany()).count;
    // Pings cascade from the driver, but this is staff location data — delete
    // it explicitly and report the count rather than letting it go silently.
    summary.driverPings = (await tx.driverPing.deleteMany()).count;
    // The driving role points at both an employee and a vehicle, so it goes
    // before either. Documents cascade from the vehicle; explicit keeps the
    // summary honest.
    summary.drivers = (await tx.driver.deleteMany()).count;
    summary.vehicleDocuments = (await tx.vehicleDocument.deleteMany()).count;
    summary.vehicles = (await tx.vehicle.deleteMany()).count;
    // HR: employees reference teachers, so they go first. The children cascade,
    // but explicit deletes are self-documenting and survive a future FK change.
    summary.leaveRequests = (await tx.leaveRequest.deleteMany()).count;
    summary.leaveAdjustments = (await tx.leaveAdjustment.deleteMany()).count;
    summary.employeeDocuments = (await tx.employeeDocument.deleteMany()).count;
    summary.employees = (await tx.employee.deleteMany()).count;
    summary.leaveTypes = (await tx.leaveType.deleteMany()).count;
    // TeacherSubject cascades from teachers, but delete it explicitly first so
    // the summary is honest and a future FK change can't leave orphans.
    summary.teacherSubjects = (await tx.teacherSubject.deleteMany()).count;
    summary.teachers = (await tx.teacher.deleteMany()).count;
    // Subjects go after sessions (deleted above) cleared their subjectId links.
    summary.subjects = (await tx.subject.deleteMany()).count;
    summary.terms = (await tx.term.deleteMany()).count;
    summary.gradeLevels = (await tx.gradeLevel.deleteMany()).count;
  });

  await writeAudit("System", "wipe-all", "DELETE", { after: summary });
  revalidatePath(`/${locale}`, "layout");
  return { ok: true, summary };
}

/* ------------------------------- demo seeder ------------------------------- */

const GRADE_LEVELS = [
  { code: "ب م", nameAr: "ابتدائي أساسي", nameEn: "Primary (Basic)", sortOrder: 1, center: 100, home: null as number | null },
  { code: "ب", nameAr: "ابتدائي", nameEn: "Primary", sortOrder: 2, center: 125, home: 150 },
  { code: "ع", nameAr: "إعدادي", nameEn: "Prep", sortOrder: 3, center: 150, home: 175 },
  { code: "ث", nameAr: "ثانوي", nameEn: "Secondary", sortOrder: 4, center: 175, home: 200 },
  { code: "جامعة", nameAr: "جامعة", nameEn: "University", sortOrder: 5, center: 200, home: 250 },
];

const EXPENSE_CATEGORIES: [string, string][] = [
  ["سيارات وبترول ومواصلات", "Cars, fuel & transport"],
  ["نثريات", "Miscellaneous"],
  ["كهرباء ومياه", "Electricity & water"],
  ["رواتب", "Salaries"],
  ["نسبة المعلمين والإدارة", "Teacher & admin commission"],
  ["ايجار سكن ومركز", "Rent (housing & center)"],
  ["تليفون وانترنت", "Phone & internet"],
  ["دعاية وإعلان", "Advertising"],
  ["صيانة المركز والسكن", "Maintenance (center & housing)"],
  ["أدوات مكتبية", "Office supplies"],
  ["سلف", "Advances / loans"],
  ["م إدارية وتراخيص", "Admin & licensing"],
];

const TEACHER_NAMES = [
  "شيرين", "نجلاء", "فلسطين", "حنان", "نشوى", "ميساء", "طه", "علاء",
  "محمد قرني", "رحاب", "فاطمة", "وفاء", "مروان", "نداء", "نسيبة",
];
const STUDENT_NAMES = [
  "موزه", "منيره", "هند", "عائشه", "فهد", "مريم", "راشد", "فيصل", "سلطان",
  "سارة", "خالد", "نايف", "عفراء", "جميلة", "ريان", "شهد", "عبدالعزيز",
  "دانة", "لولوة", "محمد",
];
const GUARDIAN_NAMES = [
  "أبو خالد", "أبو محمد", "أم فهد", "أبو سلطان", "أم سارة", "أبو راشد",
  "أم ريان", "أبو نايف", "أم شهد", "أبو عبدالعزيز",
];
const EXPENSE_DESCRIPTIONS = [
  "بترول سيارة", "ورق طباعة", "انترنت المركز", "صيانة مكيفات", "ضيافة",
  "كهرباء", "إيجار", "أدوات مكتبية", "دعاية انستغرام", "رسوم ترخيص",
];

// Doha districts (Arabic name, lat, lng) so seeded homes cluster in real
// places for the transport ETA/allocation demos rather than at (0,0). Points
// are lightly jittered per person; the centre is the default trip endpoint.
const DOHA_CENTER = { lat: 25.2854, lng: 51.531 };
const DOHA_AREAS: [string, number, number][] = [
  ["الوكرة", 25.171, 51.603],
  ["الريان", 25.2919, 51.424],
  ["الوعب", 25.264, 51.479],
  ["الغرافة", 25.33, 51.443],
  ["الخليج الغربي", 25.323, 51.531],
  ["المنصورة", 25.279, 51.535],
  ["أم صلال", 25.416, 51.402],
  ["الدفنة", 25.321, 51.529],
  ["معيذر", 25.256, 51.427],
  ["الثمامة", 25.236, 51.547],
];

const nameAt = (pool: string[], i: number) =>
  i < pool.length ? pool[i] : `${pool[i % pool.length]} ${Math.floor(i / pool.length) + 1}`;

/** Built from SEED_SPEC so the schema can't drift from the modal's inputs. */
const countsSchema = z.object(
  Object.fromEntries(
    SEED_SPEC.map((s) => [
      s.key,
      z.coerce.number().int().min(0).max(s.max).default(s.default),
    ]),
  ) as { [K in SeedKey]: z.ZodDefault<z.ZodNumber> },
);
export type SeedCounts = z.infer<typeof countsSchema>;

/** Deterministic-ish PRNG so repeated seeds don't look identical but stay stable per run. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/**
 * Generate editable-count demo data. Ensures reference data (grade levels,
 * price matrix, expense categories) exists first, so it also restores a
 * freshly-wiped system to a usable state.
 */
export async function seedDemoData(locale: string, input: SeedCounts): Promise<DataState> {
  const session = await guardAdmin();
  if (!session) return { error: "forbidden" };
  const parsed = countsSchema.safeParse(input);
  if (!parsed.success) {
    // Name the offending field and its allowed range — a bare "invalid" left
    // the admin guessing which of twenty inputs the form disliked.
    const issue = parsed.error.issues[0];
    const key = String(issue?.path?.[0] ?? "");
    const spec = SEED_SPEC.find((s) => s.key === key);
    return spec
      ? { error: "seedRange", field: key, max: spec.max }
      : { error: "invalid" };
  }
  const n = parsed.data;
  const rand = rng(Date.now() % 2147483647);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  // A realistic Doha home: pick a district, jitter ~±1 km, label the plot. Feeds
  // the transport module's coordinates so ETA/allocation demos on real geography.
  const geoPoint = () => {
    const [area, lat, lng] = pick(DOHA_AREAS);
    const jitter = () => (rand() - 0.5) * 0.02;
    return {
      homeLat: +(lat + jitter()).toFixed(6),
      homeLng: +(lng + jitter()).toFixed(6),
      address: `${area} - قطعة ${100 + Math.floor(rand() * 800)}`,
    };
  };

  // --- reference data (idempotent) ---
  const EFFECTIVE_FROM = new Date("2024-09-01T00:00:00.000Z");
  const levels: { id: string; code: string; center: number | null; home: number | null }[] = [];
  for (const g of GRADE_LEVELS) {
    const level = await db.gradeLevel.upsert({
      where: { code: g.code },
      update: {},
      create: { code: g.code, nameAr: g.nameAr, nameEn: g.nameEn, sortOrder: g.sortOrder },
    });
    for (const [location, price] of [["CENTER", g.center], ["HOME", g.home]] as const) {
      if (price == null) continue;
      await db.priceRule.upsert({
        where: {
          gradeLevelId_location_effectiveFrom: {
            gradeLevelId: level.id, location, effectiveFrom: EFFECTIVE_FROM,
          },
        },
        update: {},
        create: { gradeLevelId: level.id, location, pricePerHour: price, effectiveFrom: EFFECTIVE_FROM },
      });
    }
    levels.push({ id: level.id, code: g.code, center: g.center, home: g.home });
  }
  for (let i = 0; i < EXPENSE_CATEGORIES.length; i++) {
    const [nameAr, nameEn] = EXPENSE_CATEGORIES[i];
    const existing = await db.expenseCategory.findFirst({ where: { nameAr } });
    if (!existing) await db.expenseCategory.create({ data: { nameAr, nameEn, sortOrder: i + 1 } });
  }

  // Point each category at the expense account it belongs to. Without this
  // every posted expense falls back to 5900 miscellaneous and the P&L says
  // nothing useful — fuel, rent and salaries all land in one bucket. Only
  // unmapped categories are touched, so a deliberate mapping is never
  // overwritten, and it is a no-op until the chart of accounts exists.
  const CATEGORY_ACCOUNTS: [string, string][] = [
    ["سيارات وبترول ومواصلات", "5100"],
    ["كهرباء ومياه", "5310"],
    ["تليفون وانترنت", "5310"],
    ["رواتب", "5000"],
    ["نسبة المعلمين والإدارة", "5000"],
    ["ايجار سكن ومركز", "5300"],
    ["دعاية وإعلان", "5500"],
    ["صيانة المركز والسكن", "5400"],
    ["أدوات مكتبية", "5600"],
    ["نثريات", "5900"],
    ["م إدارية وتراخيص", "5900"],
  ];
  for (const [nameAr, code] of CATEGORY_ACCOUNTS) {
    const account = await db.account.findFirst({ where: { code }, select: { id: true } });
    if (!account) continue;
    await db.expenseCategory.updateMany({
      where: { nameAr, accountId: null },
      data: { accountId: account.id },
    });
  }

  // Subjects (reference data, idempotent) — the list a booking can pick from.
  const SUBJECTS: [string, string][] = [
    ["الرياضيات", "Mathematics"],
    ["الفيزياء", "Physics"],
    ["الكيمياء", "Chemistry"],
    ["الأحياء", "Biology"],
    ["اللغة العربية", "Arabic"],
    ["اللغة الإنجليزية", "English"],
    ["العلوم", "Science"],
    ["الدراسات الاجتماعية", "Social studies"],
  ];
  const subjectIds: string[] = [];
  for (let i = 0; i < SUBJECTS.length; i++) {
    const [nameAr, nameEn] = SUBJECTS[i];
    const sbj = await db.subject.upsert({
      where: { id: `seed-subject-${i}` },
      update: {},
      create: { id: `seed-subject-${i}`, nameAr, nameEn, sortOrder: i + 1 },
    });
    subjectIds.push(sbj.id);
  }

  const summary: Record<string, number> = {};

  // --- teachers / guardians / students ---
  const teacherIds: string[] = [];
  const teacherSubjectMap: Record<string, string[]> = {};
  for (let i = 0; i < n.teachers; i++) {
    const t = await db.teacher.create({
      data: {
        name: nameAt(TEACHER_NAMES, i),
        commissionPct: 50,
        phone: `5555${String(1000 + i)}`,
        // Home pickup point for the transport module (house-to-house legs).
        ...geoPoint(),
      },
    });
    teacherIds.push(t.id);
    // Give each teacher one or two subjects so the booking picker demos the
    // teacher-filtered list. Deterministic per index for a stable demo.
    const own = i % 3 === 0
      ? [subjectIds[i % subjectIds.length], subjectIds[(i + 1) % subjectIds.length]]
      : [subjectIds[i % subjectIds.length]];
    teacherSubjectMap[t.id] = [...new Set(own)];
    for (const subjectId of teacherSubjectMap[t.id]) {
      await db.teacherSubject.create({ data: { teacherId: t.id, subjectId } });
    }
  }
  summary.teachers = teacherIds.length;
  summary.subjects = subjectIds.length;

  const guardianIds: string[] = [];
  for (let i = 0; i < n.guardians; i++) {
    const g = await db.guardian.create({
      data: { name: nameAt(GUARDIAN_NAMES, i), phone: `6666${String(1000 + i)}` },
    });
    guardianIds.push(g.id);
  }
  summary.guardians = guardianIds.length;

  const students: { id: string; gradeLevelId: string; gradeYear: number }[] = [];
  for (let i = 0; i < n.students; i++) {
    const level = pick(levels);
    const s = await db.student.create({
      data: {
        name: nameAt(STUDENT_NAMES, i),
        gradeLevelId: level.id,
        guardianId: guardianIds.length ? guardianIds[i % guardianIds.length] : null,
        phone: `7777${String(1000 + i)}`,
        // Roughly a quarter study at home so location-defaulted pricing and
        // the planner's HOME markers have data to show.
        studyLocation: i % 4 === 3 ? "HOME" : "CENTER",
        // Actual school year (1-12), spread so same-grade grouping demos.
        gradeYear: (i % 12) + 1,
        // Roughly one student in six is driven by the centre, so the transport
        // planner has student rides to chain as well as teacher ones. Opt-in
        // per student — most families drive their own child.
        needsTransport: i % 6 === 1,
        // Home coordinates so HOME sessions produce real transport legs.
        ...geoPoint(),
      },
    });
    students.push({ id: s.id, gradeLevelId: level.id, gradeYear: (i % 12) + 1 });
  }
  summary.students = students.length;

  // --- one demo group ("course") so the Groups screen has data on first seed ---
  if (teacherIds.length && students.length >= 2) {
    const gy = students[0].gradeYear;
    const sameGrade = students.filter((st) => st.gradeYear === gy).slice(0, 5);
    const members = sameGrade.length >= 2 ? sameGrade : students.slice(0, Math.min(4, students.length));
    await db.studentGroup.create({
      data: {
        name: locale === "ar" ? `مجموعة الصف ${gy}` : `Grade ${gy} group`,
        teacherId: teacherIds[0],
        subjectId: subjectIds[0] ?? null,
        gradeLevelId: members[0].gradeLevelId,
        location: "CENTER",
        defaultPricePerHour: 120,
        members: {
          create: members.map((m, idx) => ({
            studentId: m.id,
            // First member on an individually agreed price; the rest inherit the default.
            pricePerHour: idx === 0 ? 100 : null,
          })),
        },
      },
    });
    summary.studentGroups = 1;
  }

  // --- packages ---
  let packages = 0;
  for (let i = 0; i < n.packages && students.length; i++) {
    const st = pick(students);
    const totalHours = pick([10, 15, 20]);
    await db.package.create({
      data: { studentId: st.id, totalHours, price: totalHours * 150, status: "ACTIVE" },
    });
    packages++;
  }
  summary.packages = packages;

  // --- sessions: spread over the last 20 days + next 5, realistic statuses ---
  const priceOf = (gradeLevelId: string, location: "CENTER" | "HOME") => {
    const l = levels.find((x) => x.id === gradeLevelId)!;
    return (location === "HOME" ? l.home ?? l.center : l.center) ?? 150;
  };
  let sessions = 0;
  const today = new Date();
  for (let i = 0; i < n.sessions && students.length && teacherIds.length; i++) {
    const st = pick(students);
    const dayOffset = Math.floor(rand() * 25) - 20; // -20 .. +4
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + dayOffset);
    const hour = 14 + Math.floor(rand() * 6); // 14:00–19:00
    const date = new Date(`${d.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}:00:00.000Z`);
    const location = rand() < 0.3 ? "HOME" : "CENTER";
    const hours = pick([1, 1, 1.5, 2]);
    const price = priceOf(st.gradeLevelId, location);
    const status =
      dayOffset < 0 ? (rand() < 0.85 ? "COMPLETED" : "NO_SHOW") : dayOffset === 0 ? "DRAFT" : "SCHEDULED";
    // Completed sessions carry attendance stamps so the check-in history and
    // actual-hours reports have data to show.
    const attended = status === "COMPLETED";
    const checkOut = new Date(date.getTime() + hours * 3600_000);
    // Most lessons carry a subject drawn from the teacher's own list, so the
    // booking card demos with subjects; some stay blank (subject is optional).
    const sTeacherId = pick(teacherIds);
    const sTeacherSubs = teacherSubjectMap[sTeacherId] ?? [];
    await db.session.create({
      data: {
        date,
        studentId: st.id,
        teacherId: sTeacherId,
        gradeLevelId: st.gradeLevelId,
        subjectId: sTeacherSubs.length && rand() < 0.75 ? pick(sTeacherSubs) : null,
        location,
        hours,
        pricePerHour: price,
        total: price * hours,
        paymentStatus: "UNPAID",
        status,
        studentCheckInAt: attended ? date : null,
        studentCheckOutAt: attended ? checkOut : null,
        teacherCheckInAt: attended ? date : null,
        checkInMethod: attended ? pick(["KIOSK", "KIOSK", "QR", "MANUAL"]) : null,
        actualHours: attended ? hours : null,
      },
    });
    sessions++;
  }
  summary.sessions = sessions;

  // --- today's roster: confirmed sessions around "now" in live check-in
  // states, so the attendance screens demo without anyone scanning a card ---
  let checkins = 0;
  for (let i = 0; i < n.checkins && students.length && teacherIds.length; i++) {
    const st = pick(students);
    // Spread starts from 2h ago to 3h ahead of the actual current time.
    const start = new Date(today.getTime() + (-120 + i * (300 / Math.max(1, n.checkins))) * 60_000);
    const hours = pick([1, 1, 1.5]);
    const end = new Date(start.getTime() + hours * 3600_000);
    const started = start.getTime() <= today.getTime();
    const finished = end.getTime() <= today.getTime();
    const price = priceOf(st.gradeLevelId, "CENTER");
    await db.session.create({
      data: {
        date: start,
        studentId: st.id,
        teacherId: pick(teacherIds),
        gradeLevelId: st.gradeLevelId,
        location: "CENTER",
        hours,
        pricePerHour: price,
        total: price * hours,
        paymentStatus: "UNPAID",
        status: finished ? "COMPLETED" : started ? "CHECKED_IN" : "SCHEDULED",
        studentCheckInAt: started ? start : null,
        studentCheckOutAt: finished ? end : null,
        teacherCheckInAt: started ? start : null,
        checkInMethod: started ? pick(["KIOSK", "KIOSK", "QR"]) : null,
        actualHours: finished ? hours : null,
      },
    });
    checkins++;
  }
  summary.checkins = checkins;

  // --- terms (payroll TERM mode needs these) ---
  let terms = 0;
  if (n.terms > 0) {
    const year = today.getUTCFullYear();
    // Walk backwards from the current term so the newest is always "current".
    for (let i = 0; i < n.terms; i++) {
      const startMonth = i * -6 + 6; // …, +6, 0, -6 → two terms per year
      const start = new Date(Date.UTC(year, startMonth, 1));
      const end = new Date(Date.UTC(year, startMonth + 6, 0, 23, 59, 59, 999));
      const label = `${start.toISOString().slice(0, 7)}`;
      const existing = await db.term.findFirst({ where: { startDate: start } });
      if (existing) continue;
      await db.term.create({
        data: {
          nameAr: `الفصل ${i + 1} (${label})`,
          nameEn: `Term ${i + 1} (${label})`,
          startDate: start,
          endDate: end,
          active: true,
        },
      });
      terms++;
    }
  }
  summary.terms = terms;

  // --- teacher availability (weekday windows) ---
  let availability = 0;
  for (let i = 0; i < n.availability && teacherIds.length; i++) {
    const teacherId = teacherIds[i % teacherIds.length];
    // Spread across the Gulf week, afternoons — matches the planner's day start.
    const weekday = [6, 0, 1, 2, 3, 4][i % 6];
    const startMin = pick([13 * 60, 14 * 60, 15 * 60]);
    const dupe = await db.teacherAvailability.findFirst({ where: { teacherId, weekday } });
    if (dupe) continue;
    await db.teacherAvailability.create({
      data: { teacherId, weekday, startMin, endMin: startMin + pick([240, 300, 360]) },
    });
    availability++;
  }
  summary.availability = availability;

  // --- planner templates (recurring weekly grid) ---
  let templates = 0;
  for (let i = 0; i < n.templates && teacherIds.length && students.length; i++) {
    const teacherId = teacherIds[i % teacherIds.length];
    const student = students[i % students.length];
    const weekday = [6, 0, 1, 2, 3][i % 5];
    const startMin = 14 * 60 + (i % 4) * 90;
    const dupe = await db.plannerTemplate.findFirst({
      where: { teacherId, studentId: student.id, weekday, startMin },
    });
    if (dupe) continue;
    await db.plannerTemplate.create({
      data: {
        teacherId,
        studentId: student.id,
        weekday,
        startMin,
        hours: pick([1, 1, 1.5]),
        location: rand() < 0.3 ? "HOME" : "CENTER",
      },
    });
    templates++;
  }
  summary.templates = templates;

  // --- leads (spread across the pipeline, some follow-ups already overdue) ---
  const seededLeads: { id: string; name: string; phone: string | null; gradeLevelId: string | null; status: string }[] = [];
  for (let i = 0; i < n.leads; i++) {
    const status = LEAD_STATUSES[i % LEAD_STATUSES.length];
    const follow = new Date(today);
    // Every third lead is overdue so the board's highlighting is visible.
    follow.setUTCDate(follow.getUTCDate() + (i % 3 === 0 ? -Math.ceil(rand() * 5) : Math.ceil(rand() * 10)));
    const lead = await db.lead.create({
      data: {
        name: nameAt(STUDENT_NAMES, i + 100),
        phone: `3333${String(1000 + i).slice(-4)}`,
        source: pick(["زيارة", "توصية", "إنستغرام", "إعلان"]),
        status,
        gradeLevelId: levels.length ? pick(levels).id : null,
        followUpAt: new Date(follow.toISOString().slice(0, 10) + "T00:00:00.000Z"),
      },
    });
    seededLeads.push({ id: lead.id, name: lead.name, phone: lead.phone, gradeLevelId: lead.gradeLevelId, status });
  }
  summary.leads = seededLeads.length;

  // --- trial sessions: mirror bookTrialSession — inactive placeholder
  // student, zero-price DRAFT session, lead moved to TRIAL ---
  let trials = 0;
  // Early-pipeline leads first: booking a trial for a WON lead makes no sense.
  const trialCandidates = [
    ...seededLeads.filter((l) => l.status === "NEW" || l.status === "CONTACTED"),
    ...seededLeads.filter((l) => l.status === "TRIAL"),
  ];
  for (let i = 0; i < n.trialSessions && trialCandidates.length && teacherIds.length && levels.length; i++) {
    const lead = trialCandidates[i % trialCandidates.length];
    if (i >= trialCandidates.length) break; // one trial per lead
    const gradeLevelId = lead.gradeLevelId ?? levels[0].id;
    const placeholder = await db.student.create({
      data: {
        name: lead.name,
        phone: lead.phone,
        gradeLevelId,
        active: false,
        notes: `TRIAL — lead ${lead.id}`,
      },
    });
    await db.lead.update({
      where: { id: lead.id },
      data: { studentId: placeholder.id, status: "TRIAL" },
    });
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + 1 + i); // upcoming days, one per day
    const start = new Date(`${d.toISOString().slice(0, 10)}T${String(15 + (i % 4)).padStart(2, "0")}:00:00.000Z`);
    await db.session.create({
      data: {
        date: start,
        studentId: placeholder.id,
        teacherId: pick(teacherIds),
        gradeLevelId,
        location: "CENTER",
        hours: 1,
        pricePerHour: 0,
        total: 0,
        paymentStatus: "PAID", // nothing to collect
        status: "DRAFT",
        isTrial: true,
        leadId: lead.id,
      },
    });
    trials++;
  }
  summary.trialSessions = trials;

  // --- portal demo accounts (teacher + parent), password demo1234 ---
  // Upserted by email so a reseed relinks them to the freshly seeded people
  // instead of leaving them pointing at deleted rows.
  let portalUsers = 0;
  if (n.portalUsers > 0) {
    const portalHash = await hashPassword("demo1234");
    for (let i = 0; i < n.portalUsers; i++) {
      const k = Math.floor(i / 2);
      const isTeacher = i % 2 === 0;
      if (isTeacher && !teacherIds[k]) continue;
      if (!isTeacher && !guardianIds[k]) continue;
      const email = isTeacher ? `teacher${k + 1}@demo.qa` : `parent${k + 1}@demo.qa`;
      const linked = isTeacher
        ? await db.teacher.findUnique({ where: { id: teacherIds[k] } })
        : await db.guardian.findUnique({ where: { id: guardianIds[k] } });
      const data = {
        name: linked?.name ?? email,
        role: isTeacher ? "TEACHER" : "PARENT",
        active: true,
        passwordHash: portalHash,
        teacherId: isTeacher ? teacherIds[k] : null,
        guardianId: isTeacher ? null : guardianIds[k],
      };
      await db.user.upsert({ where: { email }, create: { email, ...data }, update: data });
      portalUsers++;
    }
  }
  summary.portalUsers = portalUsers;

  // --- payments ---
  const existingMax = await db.payment.findMany({ select: { receiptNo: true } });
  let receipt = Math.max(1000, ...existingMax.map((p) => parseInt(p.receiptNo, 10) || 0)) + 1;
  let payments = 0;
  for (let i = 0; i < n.payments && students.length; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - Math.floor(rand() * 20));
    await db.payment.create({
      data: {
        date: new Date(d.toISOString().slice(0, 10) + "T00:00:00.000Z"),
        receiptNo: String(receipt++),
        studentId: pick(students).id,
        teacherId: pick(teacherIds),
        amount: pick([125, 150, 175, 200, 300, 350]),
        // Every method appears so the collections-by-method report demos.
        method: pick(["CASH", "CASH", "CASH", "POS", "POS", "QPAY", "TRANSFER", "CHEQUE"]),
      },
    });
    payments++;
  }
  summary.payments = payments;

  // --- suppliers (accounting module vendor register) ---
  const SUPPLIER_NAMES = [
    "مكتبة الريان",
    "شركة النظافة الحديثة",
    "قرطاسية الوكرة",
    "مؤسسة الصيانة المتحدة",
    "مطبعة الخليج",
    "شركة النقل السريع",
  ];
  const supplierIds: string[] = [];
  for (let i = 0; i < n.suppliers; i++) {
    const s = await db.supplier.create({
      data: {
        name: nameAt(SUPPLIER_NAMES, i),
        phone: `4444${String(1000 + i)}`,
      },
    });
    supplierIds.push(s.id);
  }
  summary.suppliers = supplierIds.length;

  // --- expenses ---
  const cats = await db.expenseCategory.findMany();
  let expenses = 0;
  for (let i = 0; i < n.expenses && cats.length; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - Math.floor(rand() * 25));
    await db.expense.create({
      data: {
        date: new Date(d.toISOString().slice(0, 10) + "T00:00:00.000Z"),
        description: pick(EXPENSE_DESCRIPTIONS),
        categoryId: pick(cats).id,
        amount: pick([50, 90, 100, 150, 250, 375, 500]),
        // Half the expenses carry a vendor so the supplier register demos.
        supplierId: supplierIds.length && i % 2 === 0 ? pick(supplierIds) : null,
      },
    });
    expenses++;
  }
  summary.expenses = expenses;


  // --- HR: employees, documents, leave, payroll runs ---
  // Seeded last so teacher links and dates can lean on everything above.
  await ensureLeaveTypes();

  // WPS establishment settings — demo values so the SIF export works out of
  // the box on seeded data. Only filled where EMPTY: a seed run on a system
  // whose real EID and IBAN are configured must never clobber them.
  for (const [key, value] of [
    ["wpsEmployerEID", "10007230"],
    ["wpsPayerEID", "10007230"],
    ["wpsPayerBank", "QNB"],
    ["wpsPayerIBAN", "QA87QNBAQAQAXXX00000693123456"],
    ["wpsSifVersion", "1"],
    // Centre location — the default endpoint of every transport trip. Filled
    // only if empty so a reseed never moves a real, configured centre pin.
    ["centerLat", String(DOHA_CENTER.lat)],
    ["centerLng", String(DOHA_CENTER.lng)],
  ] as const) {
    const existing = await db.setting.findUnique({ where: { key } });
    if (!existing?.value) {
      await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
  }

  const HR_TITLES = [
    ["موظفة استقبال", "RECEPTION"],
    ["محاسب", "ADMIN"],
    ["منسق إداري", "ADMIN"],
    ["سائق", "TRANSPORT"],
    ["مشرفة نظافة", "OTHER"],
  ] as const;
  const HR_BANKS = ["QNB", "DBQ", "CBQ"] as const;
  const employeeIds: string[] = [];
  // employeeNo is unique — a reseed on top of existing employees must continue
  // the sequence, not restart at EMP101 and crash.
  const existingNos = await db.employee.findMany({ select: { employeeNo: true } });
  let nextEmpNo =
    101 +
    existingNos.reduce((max, r) => {
      const m = /^EMP(\d+)$/.exec(r.employeeNo ?? "");
      return m ? Math.max(max, Number(m[1]) - 100) : max;
    }, 0);
  // First few employees are the seeded teachers themselves — the case the HR
  // module was built around (one payslip combining salary + commission).
  const linkedTeacherCount = Math.min(3, n.employees, teacherIds.length);
  for (let i = 0; i < n.employees; i++) {
    const linkedTeacherId = i < linkedTeacherCount ? teacherIds[i] : null;
    const teacher = linkedTeacherId
      ? await db.teacher.findUnique({ where: { id: linkedTeacherId } })
      : null;
    const [jobTitle, department] = linkedTeacherId
      ? (["معلم/ة", "TEACHING"] as const)
      : HR_TITLES[(i - linkedTeacherCount) % HR_TITLES.length];
    // Hire dates spread 0.5–6.5 years back; one lands near the 5-year mark so
    // the leave-rate blend and gratuity accrual are demoable out of the box.
    const yearsBack = i === 0 ? 5.5 : 0.5 + rand() * 6;
    const hire = new Date(today);
    hire.setUTCDate(hire.getUTCDate() - Math.round(yearsBack * 365));
    const bank = pick([...HR_BANKS]);
    const e = await db.employee.create({
      data: {
        name: teacher?.name ?? `${jobTitle} ${i + 1}`,
        nameEn: teacher?.nameEn ?? null,
        teacherId: linkedTeacherId,
        employeeNo: `EMP${String(nextEmpNo++)}`,
        jobTitle,
        department,
        // Synthetic but shape-valid: 11-digit QID, 29-char Qatari IBAN — so
        // the WPS export demo validates instead of tripping on the fixtures.
        qid: `284${String(10000000 + Math.floor(rand() * 89999999))}`,
        bankShortName: bank,
        // 29 chars exactly (QA + 2 check digits + 25): the SIF validator
        // rejects anything else, and the whole point of seeding is a demo
        // export that passes.
        iban: `QA58${bank.padEnd(4, "X")}QAQAXXX00000000${String(100000 + Math.floor(rand() * 899999))}`,
        basicSalary: linkedTeacherId ? pick([2000, 3000, 4000]) : pick([2500, 3500, 4500]),
        allowances: pick([0, 0, 500, 800]),
        hireDate: hire,
        phone: `5566${String(1000 + i)}`,
        contractType: pick(["UNLIMITED", "UNLIMITED", "LIMITED"]),
        // Shift start/end point for a driver; harmless address for the rest.
        ...geoPoint(),
      },
    });
    employeeIds.push(e.id);
  }
  summary.employees = employeeIds.length;

  // Documents: cycle types; roughly a third expire soon (or just expired) so
  // the HR expiry banner has something to show.
  const DOC_TYPES = ["QID", "VISA", "CONTRACT", "HEALTH_CARD"] as const;
  let docs = 0;
  for (let i = 0; i < n.employeeDocs && employeeIds.length; i++) {
    const type = DOC_TYPES[i % DOC_TYPES.length];
    const bucket = i % 3;
    const expires = new Date(today);
    expires.setUTCDate(
      expires.getUTCDate() +
        (bucket === 0
          ? 7 + Math.floor(rand() * 40) // expiring soon → amber/red
          : bucket === 1
            ? -(3 + Math.floor(rand() * 20)) // already expired
            : 120 + Math.floor(rand() * 400)), // comfortably valid
    );
    const issued = new Date(expires);
    issued.setUTCFullYear(issued.getUTCFullYear() - 1);
    await db.employeeDocument.create({
      data: {
        employeeId: employeeIds[i % employeeIds.length],
        type,
        number: `${type.slice(0, 2)}${String(100000 + Math.floor(rand() * 899999))}`,
        issuedOn: issued,
        expiresOn: expires,
      },
    });
    docs++;
  }
  summary.employeeDocs = docs;

  // --- Transport: fleet + drivers ---
  // Seeded regardless of the module flag, so an admin who switches transport on
  // lands on populated screens instead of three empty registers.
  const VEHICLE_MODELS: [string, string, number, number][] = [
    ["Toyota", "Hiace", 2021, 11],
    ["Nissan", "Urvan", 2019, 12],
    ["Toyota", "Corolla", 2022, 4],
    ["Hyundai", "Staria", 2023, 8],
    ["Kia", "Carnival", 2020, 6],
  ];
  const vehicleIds: string[] = [];
  for (let i = 0; i < n.vehicles; i++) {
    const [make, model, year, capacity] = VEHICLE_MODELS[i % VEHICLE_MODELS.length];
    // Qatari plates are up to 6 digits; keep them unique across a reseed by
    // continuing from whatever is already there.
    const plate = String(100000 + i + Math.floor(rand() * 800000));
    const existing = await db.vehicle.findUnique({ where: { plate } });
    if (existing) continue;
    const v = await db.vehicle.create({
      data: {
        plate,
        make,
        model,
        year,
        capacity,
        odometerKm: 20_000 + Math.floor(rand() * 180_000),
        active: true,
      },
    });
    vehicleIds.push(v.id);
  }
  summary.vehicles = vehicleIds.length;

  // Vehicle papers: same three-bucket spread as the HR documents, so the
  // expiry banner has an expired one, an expiring one and a healthy one.
  const V_DOC_TYPES = ["REGISTRATION", "INSURANCE", "INSPECTION"] as const;
  let vDocs = 0;
  for (let i = 0; i < n.vehicleDocs && vehicleIds.length; i++) {
    const bucket = i % 3;
    const expires = new Date(today);
    expires.setUTCDate(
      expires.getUTCDate() +
        (bucket === 0
          ? 7 + Math.floor(rand() * 40) // expiring soon → amber
          : bucket === 1
            ? -(3 + Math.floor(rand() * 20)) // already expired → red
            : 120 + Math.floor(rand() * 400)), // comfortably valid
    );
    const issued = new Date(expires);
    issued.setUTCFullYear(issued.getUTCFullYear() - 1);
    const type = V_DOC_TYPES[i % V_DOC_TYPES.length];
    await db.vehicleDocument.create({
      data: {
        vehicleId: vehicleIds[i % vehicleIds.length],
        type,
        number: `${type.slice(0, 3)}${String(100000 + Math.floor(rand() * 899999))}`,
        issuedOn: issued,
        expiresOn: expires,
      },
    });
    vDocs++;
  }
  summary.vehicleDocs = vDocs;

  // Drivers: the driving role layered onto seeded employees. Prefer the ones in
  // the TRANSPORT department (the seeded «سائق»), then fall back to anyone —
  // a small centre really does have the receptionist drive.
  let driverCount = 0;
  if (n.drivers > 0 && employeeIds.length) {
    const candidates = await db.employee.findMany({
      where: { id: { in: employeeIds }, driver: { is: null } },
      orderBy: [{ department: "asc" }, { name: "asc" }],
    });
    const ordered = [
      ...candidates.filter((e) => e.department === "TRANSPORT"),
      ...candidates.filter((e) => e.department !== "TRANSPORT"),
    ];
    for (let i = 0; i < n.drivers && i < ordered.length; i++) {
      // One driver's licence expires inside the alert window so the banner demos.
      const licence = new Date(today);
      licence.setUTCDate(licence.getUTCDate() + (i === 0 ? 25 : 300 + Math.floor(rand() * 400)));
      const start = pick([6 * 60, 7 * 60, 12 * 60]);
      await db.driver.create({
        data: {
          employeeId: ordered[i].id,
          licenceNo: `QD${String(100000 + Math.floor(rand() * 899999))}`,
          licenceExpiry: licence,
          defaultVehicleId: vehicleIds.length ? vehicleIds[i % vehicleIds.length] : null,
          shiftStartMin: start,
          shiftEndMin: start + pick([480, 540, 600]),
          active: true,
        },
      });
      driverCount++;
    }
  }
  summary.drivers = driverCount;

  // Fuel + maintenance: a short history per vehicle so the cost report has
  // something to divide by. Odometer readings climb monotonically, which is
  // what makes the full-to-full economy figure computable at all.
  let fuelLogs = 0;
  let maintenanceLogs = 0;
  if (vehicleIds.length) {
    const fleetCat =
      (await db.expenseCategory.findFirst({ where: { nameAr: { contains: "مواصلات" } } })) ??
      (await db.expenseCategory.findFirst());
    for (const vehicleId of vehicleIds) {
      const v = await db.vehicle.findUnique({ where: { id: vehicleId } });
      if (!v) continue;
      let odo = Math.max(0, v.odometerKm - 2400);
      for (let i = 0; i < 4; i++) {
        odo += 550 + Math.floor(rand() * 250);
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - (4 - i) * 7);
        const litres = 40 + Math.floor(rand() * 25);
        const cost = Math.round(litres * 1.9 * 100) / 100;
        const expense = fleetCat
          ? await db.expense.create({
              data: {
                date: d,
                description: `وقود — ${v.plate}`,
                categoryId: fleetCat.id,
                amount: cost,
                status: "APPROVED",
              },
            })
          : null;
        await db.fuelLog.create({
          data: {
            vehicleId,
            date: d,
            litres,
            cost,
            odometerKm: odo,
            expenseId: expense?.id ?? null,
          },
        });
        fuelLogs++;
      }
      // One service visit per vehicle, with the next one already scheduled.
      const md = new Date(today);
      md.setUTCDate(md.getUTCDate() - 20);
      const mcost = pick([250, 400, 650, 900]);
      const mexp = fleetCat
        ? await db.expense.create({
            data: {
              date: md,
              description: `صيانة دورية — ${v.plate}`,
              categoryId: fleetCat.id,
              amount: mcost,
              status: "APPROVED",
            },
          })
        : null;
      const nextOn = new Date(md);
      nextOn.setUTCMonth(nextOn.getUTCMonth() + 6);
      await db.maintenanceLog.create({
        data: {
          vehicleId,
          date: md,
          kind: pick(["SERVICE", "SERVICE", "REPAIR", "TYRES"]),
          description: "صيانة دورية",
          cost: mcost,
          odometerKm: odo,
          nextDueKm: odo + 10_000,
          nextDueOn: nextOn,
          expenseId: mexp?.id ?? null,
        },
      });
      maintenanceLogs++;
      await db.vehicle.update({ where: { id: vehicleId }, data: { odometerKm: odo } });
    }
  }
  summary.fuelLogs = fuelLogs;
  summary.maintenanceLogs = maintenanceLogs;

  // Leave: one request per slot, never overlapping — each employee gets its
  // own month window, mixing approved history with a pending queue.
  const LEAVE_MIX = [
    { typeCode: "ANNUAL", status: "APPROVED" },
    { typeCode: "SICK", status: "APPROVED" },
    { typeCode: "ANNUAL", status: "PENDING" },
    { typeCode: "UNPAID", status: "APPROVED" },
  ] as const;
  let leave = 0;
  for (let i = 0; i < n.leaveRequests && employeeIds.length; i++) {
    const mix = LEAVE_MIX[i % LEAVE_MIX.length];
    const start = new Date(today);
    // Spread windows backwards a month per request slot to avoid overlaps for
    // the same employee; pending ones sit in the future.
    const offset = mix.status === "PENDING" ? 10 + i : -(20 + i * 30);
    start.setUTCDate(start.getUTCDate() + offset);
    const days = 1 + Math.floor(rand() * 5);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + days - 1);
    await db.leaveRequest.create({
      data: {
        employeeId: employeeIds[i % employeeIds.length],
        typeCode: mix.typeCode,
        startDate: start,
        endDate: end,
        days,
        status: mix.status,
        decidedAt: mix.status === "APPROVED" ? new Date() : null,
      },
    });
    leave++;
  }
  summary.leaveRequests = leave;

  // Payroll runs: one per previous month, PAID, with a payslip per employee.
  // Simple flat math — the point is populated screens, not payroll truth.
  let runs = 0;
  for (let r = 0; r < n.payrollRuns && employeeIds.length; r++) {
    const m = new Date(today);
    m.setUTCMonth(m.getUTCMonth() - (r + 1));
    const month = `${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, "0")}`;
    const periodStart = new Date(`${month}-01T00:00:00.000Z`);
    const periodEnd = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0, 23, 59, 59));
    const run = await db.payrollRun.create({
      data: {
        month,
        periodStart,
        periodEnd,
        status: "PAID",
        paymentMethod: "BANK",
        paidAt: periodEnd,
      },
    });
    for (const [idx, employeeId] of employeeIds.entries()) {
      const e = await db.employee.findUnique({ where: { id: employeeId } });
      if (!e) continue;
      const basic = Number(e.basicSalary);
      const allowances = Number(e.allowances);
      const commission = e.teacherId ? pick([300, 450, 600, 750]) : 0;
      const net = basic + allowances + commission;
      await db.teacherPayout.create({
        data: {
          teacherId: e.teacherId,
          employeeId,
          runId: run.id,
          periodStart,
          periodEnd,
          grossCommission: commission,
          fixedSalary: basic + allowances,
          basicSalary: basic,
          allowances,
          netPaid: net,
          workingDays: 30,
          status: "PAID",
          paidAt: periodEnd,
          paymentMethod: "BANK",
          payMode: "MONTH",
          earnMode: e.teacherId ? "BOTH" : "SALARY",
        },
      });
      void idx;
    }
    runs++;
  }
  summary.payrollRuns = runs;

  // --- cheques: a book plus a lifecycle mix so the register, forecast and
  // aging cards demo out of the box (only when the accounting module is on,
  // since the whole surface is flag-gated) ---
  let chequesSeeded = 0;
  if (n.cheques > 0 && (await accountingEnabled())) {
    const book = await db.chequeBook.create({
      data: { bankName: "QNB", accountNo: "0123456789", startNo: 101, endNo: 150, nextNo: 101 },
    });
    const CHEQUE_MIX = [
      { direction: "INCOMING", status: "RECEIVED", dueIn: 10 },
      { direction: "INCOMING", status: "DEPOSITED", dueIn: 3 },
      { direction: "INCOMING", status: "CLEARED", dueIn: -10 },
      { direction: "INCOMING", status: "RECEIVED", dueIn: -8 }, // overdue → aging demo
      { direction: "OUTGOING", status: "RECEIVED", dueIn: 14 },
      { direction: "OUTGOING", status: "CLEARED", dueIn: -5 },
    ] as const;
    for (let i = 0; i < n.cheques; i++) {
      const mix = CHEQUE_MIX[i % CHEQUE_MIX.length];
      const due = new Date(today);
      due.setUTCDate(due.getUTCDate() + mix.dueIn);
      const outgoing = mix.direction === "OUTGOING";
      await db.cheque.create({
        data: {
          direction: mix.direction,
          status: mix.status,
          chequeNo: outgoing ? String(book.nextNo + i) : `77${String(4000 + i)}`,
          amount: pick([500, 750, 1000, 1500, 2000]),
          bankName: outgoing ? book.bankName : pick(["QNB", "Doha Bank", "QIB"]),
          bookId: outgoing ? book.id : null,
          supplierId: outgoing && supplierIds.length ? pick(supplierIds) : null,
          studentId: !outgoing && students.length ? pick(students).id : null,
          payeeName: outgoing ? "مورد تجريبي" : null,
          issueDate: outgoing ? new Date(today) : null,
          receivedDate: outgoing ? null : new Date(today),
          dueDate: due,
          events: { create: { toStatus: mix.status } },
        },
      });
      chequesSeeded++;
    }
    if (chequesSeeded) {
      await db.chequeBook.update({
        where: { id: book.id },
        data: { nextNo: book.nextNo + Math.ceil(chequesSeeded / 3) },
      });
    }
  }
  summary.cheques = chequesSeeded;

  // With the accounting module on, put the seeded money on the books too —
  // otherwise the journal and reports demo empty against a full ERP.
  if (await accountingEnabled()) {
    const horizon = new Date(today);
    horizon.setUTCFullYear(horizon.getUTCFullYear() - 2);
    const posted = await backfillJournal(horizon);
    summary.journalEntries = posted.created ?? 0;
  }

  await writeAudit("System", "seed-demo", "CREATE", { after: summary });
  revalidatePath(`/${locale}`, "layout");
  return { ok: true, summary };
}
