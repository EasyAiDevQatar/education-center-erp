import "server-only";
import { db } from "./db";
import { toNumber } from "./money";
import { annualAccruedDays, balance, SICK_FULL_PAY_DAYS } from "./leave";

/**
 * The built-in leave types. Idempotent — called from the leave page so the
 * module works on first visit with no seeding step. Codes are stable API;
 * names are editable data.
 */
export async function ensureLeaveTypes() {
  const defaults = [
    { code: "ANNUAL", nameAr: "إجازة سنوية", nameEn: "Annual leave", paid: true, countsAsService: true },
    { code: "SICK", nameAr: "إجازة مرضية", nameEn: "Sick leave", paid: true, countsAsService: true },
    // Unpaid leave does not count as service — the case that can drop someone
    // below the one-year gratuity cliff (lib/gratuity.ts).
    { code: "UNPAID", nameAr: "إجازة بدون راتب", nameEn: "Unpaid leave", paid: false, countsAsService: false },
    { code: "MATERNITY", nameAr: "إجازة أمومة", nameEn: "Maternity leave", paid: true, countsAsService: true },
    { code: "OTHER", nameAr: "إجازة أخرى", nameEn: "Other leave", paid: true, countsAsService: true },
  ];
  for (const d of defaults) {
    await db.leaveType.upsert({ where: { code: d.code }, create: d, update: {} });
  }
}

export type LeaveBalanceRow = {
  employeeId: string;
  name: string;
  nameEn: string | null;
  hireDate: string | null;
  annualEntitled: number;
  annualAdjust: number;
  annualTaken: number;
  annualPending: number;
  annualRemaining: number;
  annualAvailable: number;
  sickTaken: number;
  sickCap: number;
};

/**
 * Per-employee balances for the calendar leave year containing `today`.
 *
 * Accrual-to-date, not full-year entitlement: showing 21 days to someone hired
 * last month invites granting leave they have not yet earned.
 */
export async function getLeaveBalances(todayIso: string): Promise<LeaveBalanceRow[]> {
  const year = todayIso.slice(0, 4);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const ys = new Date(`${yearStart}T00:00:00.000Z`);
  const ye = new Date(`${yearEnd}T23:59:59.999Z`);

  const [employees, requests, adjustments] = await Promise.all([
    db.employee.findMany({
      where: { status: { not: "TERMINATED" } },
      orderBy: { name: "asc" },
    }),
    db.leaveRequest.findMany({
      where: { startDate: { lte: ye }, endDate: { gte: ys }, status: { in: ["APPROVED", "PENDING"] } },
    }),
    db.leaveAdjustment.findMany({ where: { effectiveOn: { gte: ys, lte: ye } } }),
  ]);

  return employees.map((e) => {
    const mine = requests.filter((r) => r.employeeId === e.id);
    const sum = (typeCode: string, status: string) =>
      mine
        .filter((r) => r.typeCode === typeCode && r.status === status)
        .reduce((n, r) => n + toNumber(r.days), 0);
    const adj = adjustments
      .filter((a) => a.employeeId === e.id && a.typeCode === "ANNUAL")
      .reduce((n, a) => n + toNumber(a.days), 0);

    const entitled = e.hireDate
      ? annualAccruedDays({
          hireDate: e.hireDate.toISOString().slice(0, 10),
          asOf: todayIso,
          yearStart,
          yearEnd,
        })
      : 0;

    const b = balance({
      entitlement: entitled,
      adjustments: adj,
      approvedTaken: sum("ANNUAL", "APPROVED"),
      pendingTaken: sum("ANNUAL", "PENDING"),
    });

    return {
      employeeId: e.id,
      name: e.name,
      nameEn: e.nameEn,
      hireDate: e.hireDate?.toISOString().slice(0, 10) ?? null,
      annualEntitled: b.entitlement,
      annualAdjust: b.adjustments,
      annualTaken: b.taken,
      annualPending: b.pending,
      annualRemaining: b.remaining,
      annualAvailable: b.available,
      sickTaken: sum("SICK", "APPROVED"),
      sickCap: SICK_FULL_PAY_DAYS,
    };
  });
}
