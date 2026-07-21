import { describe, it, expect } from "vitest";
import { resolveSalary } from "../../lib/salary-source";

describe("resolveSalary", () => {
  it("prefers the employee record even when the teacher figure is larger", () => {
    const r = resolveSalary({
      employee: { basicSalary: 3000, allowances: 500 },
      teacher: { fixedSalary: 9000 },
    });
    expect(r).toEqual({ basic: 3000, allowances: 500, total: 3500, source: "EMPLOYEE" });
  });

  it("an employee with ZERO basic still wins — no silent fallback", () => {
    // Falling back to Teacher.fixedSalary "because the employee says 0" is
    // exactly the double-pay bug this function exists to prevent.
    const r = resolveSalary({
      employee: { basicSalary: 0, allowances: 0 },
      teacher: { fixedSalary: 4000 },
    });
    expect(r.total).toBe(0);
    expect(r.source).toBe("EMPLOYEE");
  });

  it("maps a teacher-only salary entirely to basic", () => {
    const r = resolveSalary({ teacher: { fixedSalary: 2500 } });
    expect(r).toEqual({ basic: 2500, allowances: 0, total: 2500, source: "TEACHER" });
  });

  it("returns zeros with source NONE when neither exists", () => {
    expect(resolveSalary({})).toEqual({ basic: 0, allowances: 0, total: 0, source: "NONE" });
    expect(resolveSalary({ employee: null, teacher: null }).source).toBe("NONE");
  });

  it("total is always basic + allowances", () => {
    const r = resolveSalary({ employee: { basicSalary: 1200.5, allowances: 300.25 } });
    expect(r.total).toBe(1500.75);
  });
});
