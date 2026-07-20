import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

// Fixed effective date so PriceRule upserts are stable across re-seeds.
const EFFECTIVE_FROM = new Date("2024-09-01T00:00:00.000Z");

const GRADE_LEVELS = [
  { code: "ب م", nameAr: "ابتدائي أساسي", nameEn: "Primary (Basic)", sortOrder: 1, center: 100, home: null },
  { code: "ب", nameAr: "ابتدائي", nameEn: "Primary", sortOrder: 2, center: 125, home: 150 },
  { code: "ع", nameAr: "إعدادي", nameEn: "Prep", sortOrder: 3, center: 150, home: 175 },
  { code: "ث", nameAr: "ثانوي", nameEn: "Secondary", sortOrder: 4, center: 175, home: 200 },
  { code: "جامعة", nameAr: "جامعة", nameEn: "University", sortOrder: 5, center: 200, home: 250 },
];

const EXPENSE_CATEGORIES = [
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

const TEACHERS = [
  "شيرين", "نجلاء", "فلسطين", "حنان", "نشوى", "ميساء", "طه", "علاء",
  "محمد قرني", "رحاب", "فاطمة", "وفاء", "مروان", "نداء", "نسيبة",
];

async function main() {
  console.log("Seeding reference data...");

  // Grade levels + price matrix
  const levelByCode = new Map<string, string>();
  for (const g of GRADE_LEVELS) {
    const level = await db.gradeLevel.upsert({
      where: { code: g.code },
      update: { nameAr: g.nameAr, nameEn: g.nameEn, sortOrder: g.sortOrder },
      create: { code: g.code, nameAr: g.nameAr, nameEn: g.nameEn, sortOrder: g.sortOrder },
    });
    levelByCode.set(g.code, level.id);

    if (g.center != null) {
      await db.priceRule.upsert({
        where: {
          gradeLevelId_location_effectiveFrom: {
            gradeLevelId: level.id,
            location: "CENTER",
            effectiveFrom: EFFECTIVE_FROM,
          },
        },
        update: { pricePerHour: g.center },
        create: { gradeLevelId: level.id, location: "CENTER", pricePerHour: g.center, effectiveFrom: EFFECTIVE_FROM },
      });
    }
    if (g.home != null) {
      await db.priceRule.upsert({
        where: {
          gradeLevelId_location_effectiveFrom: {
            gradeLevelId: level.id,
            location: "HOME",
            effectiveFrom: EFFECTIVE_FROM,
          },
        },
        update: { pricePerHour: g.home },
        create: { gradeLevelId: level.id, location: "HOME", pricePerHour: g.home, effectiveFrom: EFFECTIVE_FROM },
      });
    }
  }

  // Expense categories
  for (let i = 0; i < EXPENSE_CATEGORIES.length; i++) {
    const [nameAr, nameEn] = EXPENSE_CATEGORIES[i];
    const existing = await db.expenseCategory.findFirst({ where: { nameAr } });
    if (existing) {
      await db.expenseCategory.update({ where: { id: existing.id }, data: { nameEn, sortOrder: i + 1 } });
    } else {
      await db.expenseCategory.create({ data: { nameAr, nameEn, sortOrder: i + 1 } });
    }
  }

  // Settings
  const settings: Record<string, string> = {
    centerName: "المركز التعليمي",
    currency: "QAR",
    defaultLocale: "ar",
    receiptFooter: "شكراً لتعاملكم معنا",
  };
  for (const [key, value] of Object.entries(settings)) {
    await db.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  // Teachers
  const teacherByName = new Map<string, string>();
  for (const name of TEACHERS) {
    let teacher = await db.teacher.findFirst({ where: { name } });
    if (!teacher) {
      teacher = await db.teacher.create({ data: { name, commissionPct: 50 } });
    }
    teacherByName.set(name, teacher.id);
  }

  // Admin user
  const passwordHash = await bcrypt.hash("admin123", 10);
  await db.user.upsert({
    where: { email: "admin@center.qa" },
    update: {},
    create: {
      name: "مدير النظام",
      email: "admin@center.qa",
      passwordHash,
      role: "ADMIN",
      locale: "ar",
    },
  });

  // Demo transactional data (only if the DB has no sessions yet)
  const sessionCount = await db.session.count();
  if (sessionCount === 0) {
    console.log("Seeding demo transactions...");
    const th = levelByCode.get("ث")!; // secondary
    const pr = levelByCode.get("ب")!; // primary
    const students = await Promise.all(
      [
        ["روضة جاسم", th],
        ["سارة", th],
        ["فيصل", pr],
        ["مضاوي", th],
      ].map(([name, gradeLevelId]) =>
        db.student.create({ data: { name: name as string, gradeLevelId: gradeLevelId as string } }),
      ),
    );

    const mk = async (
      studentIdx: number,
      teacher: string,
      gradeLevelId: string,
      location: "CENTER" | "HOME",
      hours: number,
      price: number,
      date: string,
    ) => {
      await db.session.create({
        data: {
          date: new Date(date),
          studentId: students[studentIdx].id,
          teacherId: teacherByName.get(teacher)!,
          gradeLevelId,
          location,
          hours,
          pricePerHour: price,
          total: hours * price,
          paymentStatus: "UNPAID",
        },
      });
    };
    await mk(0, "شيرين", th, "CENTER", 2, 175, "2024-09-15");
    await mk(1, "شيرين", th, "HOME", 2, 200, "2024-09-16");
    await mk(2, "محمد قرني", pr, "CENTER", 1, 125, "2024-09-15");
    await mk(3, "شيرين", th, "CENTER", 1.5, 175, "2024-09-17");
    await mk(0, "حنان", th, "CENTER", 1, 175, "2024-09-18");

    // Payments (collected income)
    let receipt = 8600;
    const pay = async (studentIdx: number, teacher: string, amount: number, method: string, date: string) => {
      await db.payment.create({
        data: {
          date: new Date(date),
          receiptNo: String(receipt++),
          studentId: students[studentIdx].id,
          teacherId: teacherByName.get(teacher)!,
          amount,
          method,
        },
      });
    };
    await pay(0, "شيرين", 350, "CASH", "2024-09-15");
    await pay(2, "محمد قرني", 125, "POS", "2024-09-15");
    await pay(1, "شيرين", 400, "QPAY", "2024-09-16");

    // Expenses
    const cats = await db.expenseCategory.findMany();
    const catByAr = new Map(cats.map((c) => [c.nameAr, c.id]));
    const exp = async (nameAr: string, description: string, amount: number, date: string) => {
      await db.expense.create({
        data: { date: new Date(date), description, categoryId: catByAr.get(nameAr)!, amount },
      });
    };
    await exp("سيارات وبترول ومواصلات", "بترول كامري", 100, "2024-09-07");
    await exp("أدوات مكتبية", "ورق طباعة", 90, "2024-09-04");
    await exp("نسبة المعلمين والإدارة", "حسن جمعة", 300, "2024-09-07");
    await exp("تليفون وانترنت", "انترنت المركز", 375, "2024-09-16");
  }

  console.log("Seed complete. Login: admin@center.qa / admin123");
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
