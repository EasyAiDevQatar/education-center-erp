/**
 * Which record a person's salary comes from.
 *
 * A teacher who becomes an employee has two places a salary could live:
 * `Teacher.fixedSalary` (the pre-HR field) and `Employee.basicSalary +
 * allowances`. Paying both is the worst bug this module could have, so the
 * rule is one function, used by every payroll path:
 *
 *   an Employee link wins OUTRIGHT — Teacher.fixedSalary is then never read,
 *   even when the employee's figure is zero. A silent fallback "because the
 *   employee row says 0" is exactly the double-pay hazard.
 *
 * Pure, import-free, unit tested — this is money.
 */

export type SalarySource = "EMPLOYEE" | "TEACHER" | "NONE";

export function resolveSalary(input: {
  employee?: { basicSalary: number; allowances: number } | null;
  teacher?: { fixedSalary: number } | null;
}): { basic: number; allowances: number; total: number; source: SalarySource } {
  if (input.employee) {
    const basic = input.employee.basicSalary;
    const allowances = input.employee.allowances;
    return { basic, allowances, total: basic + allowances, source: "EMPLOYEE" };
  }
  if (input.teacher) {
    // The legacy field is undivided; treat it all as basic. Gratuity for a
    // teacher without an Employee record is out of scope by definition —
    // gratuity needs a hire date, which only Employee carries.
    const basic = input.teacher.fixedSalary;
    return { basic, allowances: 0, total: basic, source: "TEACHER" };
  }
  return { basic: 0, allowances: 0, total: 0, source: "NONE" };
}
