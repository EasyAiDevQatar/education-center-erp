/**
 * Qatar end-of-service gratuity — Labour Law No. 14 of 2004, Article 54.
 *
 * At least three weeks' (21 days') BASIC wage for each completed year of
 * service; nothing at all under one year; part years pro-rated. The daily
 * wage is basic ÷ 30 by the standard salary-month convention.
 *
 * Pure functions with no imports — `server-only` modules cannot be unit
 * tested, and this is the single largest amount the centre will ever owe an
 * employee at once.
 */

export const GRATUITY_DAYS_PER_YEAR = 21;
export const GRATUITY_MIN_SERVICE_YEARS = 1;
export const DAYS_IN_SALARY_MONTH = 30;

const MS_DAY = 86400000;

function parse(d: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.parse(`${d}T00:00:00.000Z`);
  return Number.isNaN(t) ? null : t;
}

/**
 * Days of service, inclusive of the hire date, exclusive of nothing — the
 * last working day counts. Unpaid leave does not count as service and is
 * subtracted, which is what can drop someone below the one-year cliff.
 */
export function serviceDays(i: {
  hireDate: string;
  endDate: string;
  unpaidLeaveDays?: number;
}): number {
  const h = parse(i.hireDate);
  const e = parse(i.endDate);
  if (h === null || e === null || e < h) return 0;
  const calendar = Math.round((e - h) / MS_DAY) + 1;
  return Math.max(0, calendar - Math.max(0, i.unpaidLeaveDays ?? 0));
}

export function serviceYears(i: {
  hireDate: string;
  endDate: string;
  unpaidLeaveDays?: number;
}): number {
  return serviceDays(i) / 365;
}

export function dailyBasic(basicSalary: number, daysInMonth = DAYS_IN_SALARY_MONTH): number {
  if (!(basicSalary > 0) || !(daysInMonth > 0)) return 0;
  return basicSalary / daysInMonth;
}

export type GratuityPolicy = {
  /** Contracts often grant more than the legal 21. */
  daysPerYear?: number;
  daysInMonth?: number;
  minServiceYears?: number;
  /** false = whole completed years only. */
  proRatePartYears?: boolean;
};

export function computeGratuity(
  i: { hireDate: string; endDate: string; basicSalary: number; unpaidLeaveDays?: number },
  policy?: GratuityPolicy,
): {
  eligible: boolean;
  serviceDays: number;
  serviceYears: number;
  daysPerYear: number;
  dailyRate: number;
  gratuityDays: number;
  amount: number;
} {
  const daysPerYear = policy?.daysPerYear ?? GRATUITY_DAYS_PER_YEAR;
  const minYears = policy?.minServiceYears ?? GRATUITY_MIN_SERVICE_YEARS;
  const proRate = policy?.proRatePartYears ?? true;

  const days = serviceDays(i);
  const years = days / 365;
  const rate = dailyBasic(i.basicSalary, policy?.daysInMonth);

  // The cliff: under the minimum, the entitlement is zero — not pro-rated.
  if (years < minYears || rate <= 0) {
    return {
      eligible: false,
      serviceDays: days,
      serviceYears: round2(years),
      daysPerYear,
      dailyRate: rate,
      gratuityDays: 0,
      amount: 0,
    };
  }

  const countedYears = proRate ? years : Math.floor(years);
  const gratuityDays = countedYears * daysPerYear;
  // ONE rounding, at the very end. Rounding the daily rate first would turn a
  // 5000 basic into 3500.07 instead of 3500.00 over 21 days.
  const amount = round2(gratuityDays * rate);

  return {
    eligible: true,
    serviceDays: days,
    serviceYears: round2(years),
    daysPerYear,
    dailyRate: rate,
    gratuityDays: round2(gratuityDays),
    amount,
  };
}

/**
 * The final settlement. Deliberately NOT floored at zero, unlike a payslip
 * net: a settlement where deductions exceed dues is a real debt the employee
 * owes back, and flooring it would hide money.
 */
export function computeSettlement(i: {
  gratuityAmount: number;
  unusedLeaveDays: number;
  dailyBasic: number;
  otherDues?: number;
  deductions?: number;
}): {
  gratuity: number;
  leaveEncashment: number;
  otherDues: number;
  deductions: number;
  net: number;
} {
  const gratuity = round2(i.gratuityAmount);
  const leaveEncashment = round2(Math.max(0, i.unusedLeaveDays) * Math.max(0, i.dailyBasic));
  const otherDues = round2(i.otherDues ?? 0);
  const deductions = round2(i.deductions ?? 0);
  return {
    gratuity,
    leaveEncashment,
    otherDues,
    deductions,
    net: round2(gratuity + leaveEncashment + otherDues - deductions),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
