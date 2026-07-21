import { describe, it, expect } from "vitest";
import {
  resolveEarningsMode,
  computePay,
  anySalary,
  isEarningsMode,
  DEFAULT_EARNINGS_MODE,
} from "../../lib/earnings-mode";

describe("resolveEarningsMode", () => {
  it("prefers the teacher's own setting", () => {
    expect(resolveEarningsMode("SALARY", "COMMISSION")).toBe("SALARY");
  });

  it("falls back to the centre default when the teacher has none", () => {
    // This is what makes the default useful: changing it moves everyone who
    // never opted out.
    expect(resolveEarningsMode(null, "BOTH")).toBe("BOTH");
    expect(resolveEarningsMode(undefined, "SALARY")).toBe("SALARY");
  });

  it("falls back again when the centre default is unset", () => {
    expect(resolveEarningsMode(null, null)).toBe(DEFAULT_EARNINGS_MODE);
  });

  it("ignores values that are not modes rather than trusting them", () => {
    // The setting is free-form text in the DB; a typo must not become a mode.
    expect(resolveEarningsMode("salary", "BOTH")).toBe("BOTH");
    expect(resolveEarningsMode("", "BOTH")).toBe("BOTH");
    expect(resolveEarningsMode("NONSENSE", "ALSO_NONSENSE")).toBe(DEFAULT_EARNINGS_MODE);
  });
});

describe("isEarningsMode", () => {
  it("accepts only the three modes", () => {
    expect(isEarningsMode("BOTH")).toBe(true);
    expect(isEarningsMode("Both")).toBe(false);
    expect(isEarningsMode(null)).toBe(false);
    expect(isEarningsMode(3)).toBe(false);
  });
});

describe("computePay", () => {
  const components = { commission: 900, salary: 4000, deductions: 100, advances: 200 };

  it("pays both parts under BOTH", () => {
    const r = computePay("BOTH", components);
    expect(r).toMatchObject({ commission: 900, salary: 4000, deductions: 100, advances: 200 });
    expect(r.net).toBe(4600); // 900 + 4000 − 100 − 200
  });

  it("drops commission under SALARY", () => {
    const r = computePay("SALARY", components);
    expect(r.commission).toBe(0);
    expect(r.salary).toBe(4000);
    expect(r.net).toBe(3700); // 4000 − 100 − 200
  });

  it("drops salary under COMMISSION", () => {
    const r = computePay("COMMISSION", components);
    expect(r.salary).toBe(0);
    expect(r.commission).toBe(900);
    expect(r.net).toBe(600); // 900 − 100 − 200
  });

  it("reports a suppressed component as zero rather than omitting it", () => {
    // A payslip showing "commission: 0" next to the mode reads differently from
    // one with no commission line at all.
    expect(computePay("SALARY", components)).toHaveProperty("commission", 0);
    expect(computePay("COMMISSION", components)).toHaveProperty("salary", 0);
  });

  it("applies deductions and advances under every mode", () => {
    for (const mode of ["SALARY", "COMMISSION", "BOTH"] as const) {
      const withCharges = computePay(mode, components);
      const without = computePay(mode, { ...components, deductions: 0, advances: 0 });
      expect(without.net - withCharges.net).toBe(300);
    }
  });

  it("never returns a negative payout", () => {
    // Payroll does not invoice a teacher; an over-deduction stops at zero.
    const r = computePay("COMMISSION", { commission: 50, salary: 0, deductions: 500, advances: 0 });
    expect(r.net).toBe(0);
  });

  it("treats a missing advances field as zero", () => {
    const r = computePay("BOTH", { commission: 100, salary: 0, deductions: 0 });
    expect(r.advances).toBe(0);
    expect(r.net).toBe(100);
  });
});

describe("anySalary", () => {
  it("is false when nobody draws a salary", () => {
    expect(anySalary([{ fixedSalary: 0 }, { fixedSalary: 0 }], "BOTH")).toBe(false);
  });

  it("is true as soon as one teacher does", () => {
    expect(anySalary([{ fixedSalary: 0 }, { fixedSalary: 3000 }], "BOTH")).toBe(true);
  });

  it("ignores a salary that the teacher's mode does not pay", () => {
    // A leftover figure on a commission-only teacher is not a reason to add a
    // column that will read as money they are owed.
    expect(anySalary([{ fixedSalary: 3000, earningsMode: "COMMISSION" }], "BOTH")).toBe(false);
    expect(anySalary([{ fixedSalary: 3000, earningsMode: "SALARY" }], "COMMISSION")).toBe(true);
  });

  it("follows the centre default for teachers who have not opted out", () => {
    expect(anySalary([{ fixedSalary: 3000, earningsMode: null }], "COMMISSION")).toBe(false);
    expect(anySalary([{ fixedSalary: 3000, earningsMode: null }], "BOTH")).toBe(true);
  });
});
