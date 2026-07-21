import { describe, it, expect } from "vitest";
import {
  serviceDays,
  computeGratuity,
  computeSettlement,
  dailyBasic,
} from "../../lib/gratuity";

describe("serviceDays", () => {
  it("is inclusive of both hire date and last working day", () => {
    expect(serviceDays({ hireDate: "2025-01-01", endDate: "2025-01-01" })).toBe(1);
    expect(serviceDays({ hireDate: "2025-01-01", endDate: "2025-12-31" })).toBe(365);
  });
  it("subtracts unpaid leave and never goes negative", () => {
    expect(serviceDays({ hireDate: "2025-01-01", endDate: "2025-01-10", unpaidLeaveDays: 4 })).toBe(6);
    expect(serviceDays({ hireDate: "2025-01-01", endDate: "2025-01-02", unpaidLeaveDays: 90 })).toBe(0);
  });
  it("is zero for a reversed range or garbage input", () => {
    expect(serviceDays({ hireDate: "2025-06-01", endDate: "2025-01-01" })).toBe(0);
    expect(serviceDays({ hireDate: "nope", endDate: "2025-01-01" })).toBe(0);
  });
});

describe("computeGratuity — the one-year cliff", () => {
  const basic = { basicSalary: 5000 };

  it("364 days of service earns exactly nothing", () => {
    const r = computeGratuity({ hireDate: "2024-01-01", endDate: "2024-12-29", ...basic });
    expect(r.serviceDays).toBe(364);
    expect(r.eligible).toBe(false);
    expect(r.amount).toBe(0);
  });

  it("365 days earns exactly 21 days' basic pay", () => {
    const r = computeGratuity({ hireDate: "2024-01-01", endDate: "2024-12-30", ...basic });
    expect(r.serviceDays).toBe(365);
    expect(r.eligible).toBe(true);
    // 5000/30 × 21 = 3500.00 — exactly, because rounding happens once at the end.
    expect(r.amount).toBe(3500);
  });

  it("366 days earns strictly more than 21 days' pay", () => {
    const r = computeGratuity({ hireDate: "2024-01-01", endDate: "2024-12-31", ...basic });
    expect(r.serviceDays).toBe(366);
    expect(r.amount).toBeGreaterThan(3500);
  });

  it("unpaid leave can push someone under the cliff", () => {
    // 380 calendar days, 40 unpaid → 340 service days → ineligible. Getting
    // this wrong is a real overpayment.
    const r = computeGratuity({
      hireDate: "2024-01-01",
      endDate: "2025-01-14",
      unpaidLeaveDays: 40,
      ...basic,
    });
    expect(r.serviceDays).toBe(340);
    expect(r.eligible).toBe(false);
    expect(r.amount).toBe(0);
  });

  it("a leap year introduces no second cliff", () => {
    const r = computeGratuity({ hireDate: "2024-02-29", endDate: "2025-02-28", ...basic });
    expect(r.serviceDays).toBe(366);
    expect(r.eligible).toBe(true);
  });
});

describe("computeGratuity — amounts and policy", () => {
  it("pro-rates part years: 5.5 years is 115.5 days, not 105", () => {
    // 2007.5 service days ≈ 5.5 years exactly.
    const r = computeGratuity(
      { hireDate: "2020-01-01", endDate: "2025-06-30", basicSalary: 3000 },
      undefined,
    );
    expect(r.gratuityDays).toBeGreaterThan(114);
    expect(r.gratuityDays).toBeLessThan(117);
  });

  it("floors to whole years when pro-rating is off", () => {
    const r = computeGratuity(
      { hireDate: "2020-01-01", endDate: "2023-11-30", basicSalary: 3000 },
      { proRatePartYears: false },
    );
    // 3.9× years → 3 whole years → 63 days.
    expect(r.gratuityDays).toBe(63);
  });

  it("rounds once at the end — never a rounded daily rate times days", () => {
    // 5000/30 = 166.666…; rounding that to 166.67 first gives 3500.07.
    const r = computeGratuity({ hireDate: "2024-01-01", endDate: "2024-12-30", basicSalary: 5000 });
    expect(r.amount).toBe(3500);
    expect(r.amount).not.toBe(3500.07);
  });

  it("a policy of 30 days/year scales linearly", () => {
    const r21 = computeGratuity({ hireDate: "2023-01-01", endDate: "2024-12-30", basicSalary: 3000 });
    const r30 = computeGratuity(
      { hireDate: "2023-01-01", endDate: "2024-12-30", basicSalary: 3000 },
      { daysPerYear: 30 },
    );
    expect(r30.amount / r21.amount).toBeCloseTo(30 / 21, 5);
  });

  it("zero basic yields zero, never NaN", () => {
    const r = computeGratuity({ hireDate: "2020-01-01", endDate: "2025-01-01", basicSalary: 0 });
    expect(r.amount).toBe(0);
    expect(Number.isNaN(r.amount)).toBe(false);
  });
});

describe("computeSettlement", () => {
  it("adds gratuity, leave encashment and dues, minus deductions", () => {
    const r = computeSettlement({
      gratuityAmount: 3500,
      unusedLeaveDays: 6,
      dailyBasic: dailyBasic(3000),
      otherDues: 200,
      deductions: 150,
    });
    expect(r.leaveEncashment).toBe(600); // 6 × 100
    expect(r.net).toBe(3500 + 600 + 200 - 150);
  });

  it("may go NEGATIVE — a debt must not be hidden by a zero floor", () => {
    // Unlike computePay: a negative payslip is meaningless, but a settlement
    // where deductions exceed dues is money the employee owes back.
    const r = computeSettlement({
      gratuityAmount: 0,
      unusedLeaveDays: 0,
      dailyBasic: 100,
      deductions: 800,
    });
    expect(r.net).toBe(-800);
  });
});
