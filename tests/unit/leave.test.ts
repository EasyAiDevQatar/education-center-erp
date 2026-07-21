import { describe, it, expect } from "vitest";
import {
  serviceYearsAt,
  annualRateForService,
  annualAccruedDays,
  sickEligible,
  sickPaidDays,
  leaveDays,
  balance,
  overlaps,
} from "../../lib/leave";

describe("serviceYearsAt", () => {
  it("counts by anniversary, not day count", () => {
    expect(serviceYearsAt("2020-03-15", "2025-03-14")).toBe(4);
    expect(serviceYearsAt("2020-03-15", "2025-03-15")).toBe(5);
  });
  it("is zero before hire or on bad input", () => {
    expect(serviceYearsAt("2025-01-01", "2024-12-31")).toBe(0);
    expect(serviceYearsAt("not-a-date", "2025-01-01")).toBe(0);
  });
});

describe("annualRateForService", () => {
  it("uses >= at the five-year threshold", () => {
    // Exactly five years is already the higher rate — the anniversary itself
    // belongs to the new regime, not the old one.
    expect(annualRateForService(4)).toBe(21);
    expect(annualRateForService(5)).toBe(28);
  });
});

describe("annualAccruedDays", () => {
  const year = { yearStart: "2024-01-01", yearEnd: "2024-12-31" };

  it("gives a full year at 21 for a long-tenured junior employee", () => {
    expect(
      annualAccruedDays({ hireDate: "2021-01-01", asOf: "2024-12-31", ...year }),
    ).toBe(21);
  });

  it("gives a full year at 28 past five years of service", () => {
    expect(
      annualAccruedDays({ hireDate: "2015-01-01", asOf: "2024-12-31", ...year }),
    ).toBe(28);
  });

  it("blends across the fifth anniversary month by month", () => {
    // Hired 2019-07-01: five years complete on 2024-07-01, so 2024 is six
    // months at 21/12 and six at 28/12 = 10.5 + 14 = 24.5. An implementation
    // that picks one rate for the whole year returns 21 or 28 and fails here.
    expect(
      annualAccruedDays({ hireDate: "2019-07-01", asOf: "2024-12-31", ...year }),
    ).toBe(24.5);
  });

  it("starts accruing at the hire date, not the year start", () => {
    // Hired mid-September: ~3.5 months of the year → about 6 days, never 21.
    const v = annualAccruedDays({ hireDate: "2024-09-15", asOf: "2024-12-31", ...year });
    expect(v).toBeGreaterThan(5);
    expect(v).toBeLessThan(7);
  });

  it("a hire on the last day of the year accrues essentially nothing", () => {
    const v = annualAccruedDays({ hireDate: "2024-12-31", asOf: "2024-12-31", ...year });
    expect(v).toBeLessThanOrEqual(0.5);
  });

  it("clamps asOf to the leave year end", () => {
    const inYear = annualAccruedDays({ hireDate: "2021-01-01", asOf: "2024-12-31", ...year });
    const after = annualAccruedDays({ hireDate: "2021-01-01", asOf: "2025-06-01", ...year });
    expect(after).toBe(inYear);
  });

  it("is zero before the hire date", () => {
    expect(
      annualAccruedDays({ hireDate: "2025-01-01", asOf: "2024-06-30", ...year }),
    ).toBe(0);
  });
});

describe("sickEligible", () => {
  it("is calendar months, not 90 days", () => {
    // Hired 1 Jan: 31 Mar is 90 days but only ~2.97 months — not eligible.
    expect(sickEligible("2024-01-01", "2024-03-31")).toBe(false);
    expect(sickEligible("2024-01-01", "2024-04-01")).toBe(true);
  });
  it("clamps at month end", () => {
    // Hired 30 Nov: February has no 30th; three months complete on Feb's last
    // day — the 28th in a common year, the 29th in a leap year.
    expect(sickEligible("2022-11-30", "2023-02-27")).toBe(false);
    expect(sickEligible("2022-11-30", "2023-02-28")).toBe(true);
    expect(sickEligible("2023-11-30", "2024-02-28")).toBe(false);
    expect(sickEligible("2023-11-30", "2024-02-29")).toBe(true);
  });
});

describe("sickPaidDays", () => {
  it("splits a request across the 14-day cap", () => {
    expect(sickPaidDays({ requestedDays: 10, alreadyTakenDays: 8 })).toEqual({
      fullPay: 6,
      unpaid: 4,
    });
  });
  it("is all unpaid once the cap is exhausted", () => {
    expect(sickPaidDays({ requestedDays: 5, alreadyTakenDays: 14 })).toEqual({
      fullPay: 0,
      unpaid: 5,
    });
  });
});

describe("leaveDays", () => {
  it("is inclusive of both endpoints — one day is one day", () => {
    // The classic off-by-one, and it changes pay directly.
    expect(leaveDays("2024-05-06", "2024-05-06")).toBe(1);
    expect(leaveDays("2024-05-06", "2024-05-10")).toBe(5);
  });
  it("defaults to calendar days — weekends inside the block count", () => {
    // Sun 5 May → Sat 11 May: seven calendar days.
    expect(leaveDays("2024-05-05", "2024-05-11")).toBe(7);
  });
  it("can count working days with a Fri/Sat weekend", () => {
    // Same week with weekend [5,6]: Sun–Thu = 5 days.
    expect(leaveDays("2024-05-05", "2024-05-11", { weekend: [5, 6] })).toBe(5);
  });
  it("does not subtract a holiday twice when it falls on a weekend", () => {
    // 2024-05-10 is a Friday; already excluded by the weekend.
    expect(
      leaveDays("2024-05-05", "2024-05-11", { weekend: [5, 6], holidays: ["2024-05-10"] }),
    ).toBe(5);
  });
  it("returns zero for a reversed range", () => {
    expect(leaveDays("2024-05-10", "2024-05-06")).toBe(0);
  });
});

describe("balance", () => {
  it("goes negative rather than hiding an over-grant", () => {
    // Unlike a payslip net, a negative leave balance is a fact HR must see.
    const b = balance({ entitlement: 21, adjustments: 0, approvedTaken: 25 });
    expect(b.remaining).toBe(-4);
  });
  it("available subtracts pending; remaining does not", () => {
    const b = balance({ entitlement: 21, adjustments: 2, approvedTaken: 10, pendingTaken: 5 });
    expect(b.remaining).toBe(13);
    expect(b.available).toBe(8);
  });
});

describe("overlaps", () => {
  it("is inclusive at both ends and symmetric", () => {
    const a = { start: "2024-05-01", end: "2024-05-10" };
    const b = { start: "2024-05-10", end: "2024-05-20" };
    expect(overlaps(a, b)).toBe(true);
    expect(overlaps(b, a)).toBe(true);
    expect(overlaps(a, { start: "2024-05-11", end: "2024-05-20" })).toBe(false);
  });
});
