"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { WIPE_PHRASE, SEED_SPEC, type SeedKey } from "@/lib/data-zone";
import { LEAD_STATUSES } from "@/lib/leads";

export type DataState = {
  ok?: boolean;
  error?: string;
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
    // HR: settlements and exports before their parents; payouts before runs.
    summary.endOfService = (await tx.endOfService.deleteMany()).count;
    summary.wpsExports = (await tx.wpsExport.deleteMany()).count;
    summary.payouts = (await tx.teacherPayout.deleteMany()).count;
    summary.payrollRuns = (await tx.payrollRun.deleteMany()).count;
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
    summary.expenseCategories = (await tx.expenseCategory.deleteMany()).count;
    summary.priceRules = (await tx.priceRule.deleteMany()).count;
    // Non-admin accounts go; remaining admins lose teacher/guardian links.
    summary.users = (await tx.user.deleteMany({ where: { role: { not: "ADMIN" } } })).count;
    await tx.user.updateMany({ data: { teacherId: null, guardianId: null } });
    summary.students = (await tx.student.deleteMany()).count;
    summary.guardians = (await tx.guardian.deleteMany()).count;
    // HR: employees reference teachers, so they go first. The children cascade,
    // but explicit deletes are self-documenting and survive a future FK change.
    summary.leaveRequests = (await tx.leaveRequest.deleteMany()).count;
    summary.leaveAdjustments = (await tx.leaveAdjustment.deleteMany()).count;
    summary.employeeDocuments = (await tx.employeeDocument.deleteMany()).count;
    summary.employees = (await tx.employee.deleteMany()).count;
    summary.leaveTypes = (await tx.leaveType.deleteMany()).count;
    summary.teachers = (await tx.teacher.deleteMany()).count;
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
  if (!parsed.success) return { error: "invalid" };
  const n = parsed.data;
  const rand = rng(Date.now() % 2147483647);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

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

  const summary: Record<string, number> = {};

  // --- teachers / guardians / students ---
  const teacherIds: string[] = [];
  for (let i = 0; i < n.teachers; i++) {
    const t = await db.teacher.create({
      data: { name: nameAt(TEACHER_NAMES, i), commissionPct: 50, phone: `5555${String(1000 + i)}` },
    });
    teacherIds.push(t.id);
  }
  summary.teachers = teacherIds.length;

  const guardianIds: string[] = [];
  for (let i = 0; i < n.guardians; i++) {
    const g = await db.guardian.create({
      data: { name: nameAt(GUARDIAN_NAMES, i), phone: `6666${String(1000 + i)}` },
    });
    guardianIds.push(g.id);
  }
  summary.guardians = guardianIds.length;

  const students: { id: string; gradeLevelId: string }[] = [];
  for (let i = 0; i < n.students; i++) {
    const level = pick(levels);
    const s = await db.student.create({
      data: {
        name: nameAt(STUDENT_NAMES, i),
        gradeLevelId: level.id,
        guardianId: guardianIds.length ? guardianIds[i % guardianIds.length] : null,
        phone: `7777${String(1000 + i)}`,
      },
    });
    students.push({ id: s.id, gradeLevelId: level.id });
  }
  summary.students = students.length;

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
    await db.session.create({
      data: {
        date,
        studentId: st.id,
        teacherId: pick(teacherIds),
        gradeLevelId: st.gradeLevelId,
        location,
        hours,
        pricePerHour: price,
        total: price * hours,
        paymentStatus: "UNPAID",
        status,
      },
    });
    sessions++;
  }
  summary.sessions = sessions;

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
  let leads = 0;
  for (let i = 0; i < n.leads; i++) {
    const status = LEAD_STATUSES[i % LEAD_STATUSES.length];
    const follow = new Date(today);
    // Every third lead is overdue so the board's highlighting is visible.
    follow.setUTCDate(follow.getUTCDate() + (i % 3 === 0 ? -Math.ceil(rand() * 5) : Math.ceil(rand() * 10)));
    await db.lead.create({
      data: {
        name: nameAt(STUDENT_NAMES, i + 100),
        phone: `3333${String(1000 + i).slice(-4)}`,
        source: pick(["زيارة", "توصية", "إنستغرام", "إعلان"]),
        status,
        gradeLevelId: levels.length ? pick(levels).id : null,
        followUpAt: new Date(follow.toISOString().slice(0, 10) + "T00:00:00.000Z"),
      },
    });
    leads++;
  }
  summary.leads = leads;

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
        method: pick(["CASH", "CASH", "POS", "QPAY"]),
      },
    });
    payments++;
  }
  summary.payments = payments;

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
      },
    });
    expenses++;
  }
  summary.expenses = expenses;

  await writeAudit("System", "seed-demo", "CREATE", { after: summary });
  revalidatePath(`/${locale}`, "layout");
  return { ok: true, summary };
}
