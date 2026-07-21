import "server-only";
import { db } from "./db";
import { requireAuth } from "./rbac";
import { redirect } from "@/i18n/navigation";
import { toNumber } from "./money";
import { getStudentBalance } from "./balances";
import type { SessionPayload } from "./session";

/**
 * Portal access is scoped by the identity baked into the JWT, never by a route
 * parameter — a teacher can only ever load their own `teacherId`, so there is
 * no id to tamper with in the URL.
 */
export async function requireTeacherPortal(locale: string): Promise<{
  session: SessionPayload;
  teacherId: string;
}> {
  const session = await requireAuth(locale);
  // Staff may look at the portal (useful for support), but only a linked
  // teacher account has data to show.
  const teacherId = session.teacherId;
  if (!teacherId) redirect({ href: "/", locale });
  return { session, teacherId: teacherId! };
}

export async function requireParentPortal(locale: string): Promise<{
  session: SessionPayload;
  guardianId: string;
}> {
  const session = await requireAuth(locale);
  const guardianId = session.guardianId;
  if (!guardianId) redirect({ href: "/", locale });
  return { session, guardianId: guardianId! };
}

function dayBounds(date: string) {
  return {
    gte: new Date(`${date}T00:00:00.000Z`),
    lte: new Date(`${date}T23:59:59.999Z`),
  };
}

/** Everything the teacher portal shows, in one round of queries. */
export async function loadTeacherPortal(teacherId: string, locale: string, day: string) {
  const monthStart = new Date(`${day.slice(0, 7)}-01T00:00:00.000Z`);

  const [teacher, todays, upcoming, drafts, monthAgg, payouts] = await Promise.all([
    db.teacher.findUnique({ where: { id: teacherId } }),
    db.session.findMany({
      where: { teacherId, date: dayBounds(day), status: { not: "DRAFT" } },
      include: { student: true, gradeLevel: true },
      orderBy: { date: "asc" },
    }),
    db.session.findMany({
      where: {
        teacherId,
        date: { gt: new Date(`${day}T23:59:59.999Z`) },
        status: { in: ["SCHEDULED", "CHECKED_IN"] },
      },
      include: { student: true, gradeLevel: true },
      orderBy: { date: "asc" },
      take: 20,
    }),
    db.session.findMany({
      where: { teacherId, date: dayBounds(day), status: "DRAFT" },
      include: { student: true },
      orderBy: { date: "asc" },
    }),
    db.session.aggregate({
      _sum: { hours: true, total: true },
      _count: true,
      where: { teacherId, status: "COMPLETED", date: { gte: monthStart } },
    }),
    db.teacherPayout.findMany({
      where: { teacherId },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { term: true },
    }),
  ]);

  const pct = toNumber(teacher?.commissionPct);
  const monthTotal = toNumber(monthAgg._sum.total);

  const line = (s: {
    id: string;
    date: Date;
    hours: Parameters<typeof toNumber>[0];
    total: Parameters<typeof toNumber>[0];
    location: string;
    status: string;
    student: { name: string };
    gradeLevel?: { nameAr: string; nameEn: string } | null;
  }) => ({
    id: s.id,
    date: s.date.toISOString().slice(0, 10),
    time: s.date.toISOString().slice(11, 16),
    studentName: s.student.name,
    levelLabel: s.gradeLevel
      ? locale === "ar"
        ? s.gradeLevel.nameAr
        : s.gradeLevel.nameEn
      : "",
    hours: toNumber(s.hours),
    total: toNumber(s.total),
    location: s.location,
    status: s.status,
  });

  return {
    teacherName: teacher?.name ?? "",
    commissionPct: pct,
    todays: todays.map(line),
    upcoming: upcoming.map(line),
    drafts: drafts.map((d) => ({
      id: d.id,
      time: d.date.toISOString().slice(11, 16),
      studentName: d.student.name,
      hours: toNumber(d.hours),
    })),
    month: {
      sessions: monthAgg._count,
      hours: toNumber(monthAgg._sum.hours),
      expected: monthTotal,
      // What the teacher would earn on those taught sessions.
      commission: (monthTotal * pct) / 100,
    },
    payouts: payouts.map((p) => ({
      id: p.id,
      periodStart: p.periodStart.toISOString().slice(0, 10),
      periodEnd: p.periodEnd.toISOString().slice(0, 10),
      payMode: p.payMode,
      termLabel: p.term ? (locale === "ar" ? p.term.nameAr : p.term.nameEn) : null,
      netPaid: toNumber(p.netPaid),
      status: p.status,
    })),
  };
}

/** Everything the parent portal shows for all of a guardian's children. */
export async function loadParentPortal(guardianId: string, locale: string) {
  const students = await db.student.findMany({
    where: { guardianId },
    include: { gradeLevel: true },
    orderBy: { name: "asc" },
  });

  const children = await Promise.all(
    students.map(async (s) => {
      const [balance, sessions, payments, packages] = await Promise.all([
        getStudentBalance(s.id),
        db.session.findMany({
          where: { studentId: s.id, status: { not: "DRAFT" } },
          include: { teacher: true },
          orderBy: { date: "desc" },
          take: 30,
        }),
        db.payment.findMany({
          where: { studentId: s.id },
          orderBy: { date: "desc" },
          take: 20,
        }),
        db.package.findMany({
          where: { studentId: s.id },
          orderBy: { purchasedAt: "desc" },
        }),
      ]);

      return {
        id: s.id,
        name: s.name,
        levelLabel: s.gradeLevel
          ? locale === "ar"
            ? s.gradeLevel.nameAr
            : s.gradeLevel.nameEn
          : "",
        balance: balance.balance,
        charges: balance.totalCharges,
        paid: balance.totalPaid,
        sessions: sessions.map((x) => ({
          id: x.id,
          date: x.date.toISOString().slice(0, 10),
          time: x.date.toISOString().slice(11, 16),
          teacherName: x.teacher?.name ?? "",
          hours: toNumber(x.hours),
          total: toNumber(x.total),
          status: x.status,
          paymentStatus: x.paymentStatus,
        })),
        payments: payments.map((p) => ({
          id: p.id,
          date: p.date.toISOString().slice(0, 10),
          amount: toNumber(p.amount),
          method: p.method,
          receiptNo: p.receiptNo,
        })),
        packages: packages.map((p) => ({
          id: p.id,
          totalHours: toNumber(p.totalHours),
          remaining: toNumber(p.totalHours) - toNumber(p.hoursUsed),
          status: p.status,
          expiresAt: p.expiresAt ? p.expiresAt.toISOString().slice(0, 10) : null,
        })),
      };
    }),
  );

  return { children };
}
