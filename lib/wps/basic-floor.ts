/**
 * WPS presentation floor for commission-heavy pay.
 *
 * WPS demands Basic Salary > 0, but the centre's tutors are largely paid
 * commission. The standard filing practice is to declare the contract's basic
 * wage in the Basic column and report the commission remainder as Extra
 * Income (the manual's own list for that column includes bonuses).
 *
 * This function only RELABELS between the two earning columns. Three
 * invariants make it safe to file:
 *
 *   1. basic + extra is unchanged — nothing is invented or hidden.
 *   2. net is untouched — what the employee receives is what the file says.
 *   3. extra never goes negative — if the month's earnings are below the
 *      floor, the whole amount is basic and that is all the file claims.
 *
 * A real declared basic at or above the floor is never reduced.
 */
export function applyBasicFloor(
  r: { basicSalary: number; extraIncome: number },
  floor: number,
): { basicSalary: number; extraIncome: number } {
  if (!(floor > 0)) return { basicSalary: r.basicSalary, extraIncome: r.extraIncome };
  const gross = r.basicSalary + r.extraIncome;
  const basic = Math.max(r.basicSalary, Math.min(floor, gross));
  return {
    basicSalary: round2(basic),
    extraIncome: round2(gross - basic),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
