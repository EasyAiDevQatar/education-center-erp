import "server-only";
import { db } from "../db";
import { toNumber } from "../money";
import type { WpsPayload, WpsEmployeeRecord } from "./generate";

/**
 * A payroll run → the canonical WPS payload.
 *
 * Mapping is truthful to the payslip arithmetic so the file reconciles by
 * construction: Basic Salary is the contractual basic, everything else earned
 * (allowances, overtime, commission) is Extra Income, and deductions carry
 * their reason code. net = basic + extra − deductions falls out of computePay.
 *
 * A commission-only teacher (basic = 0) will FAIL WPS validation downstream —
 * deliberately: the spec demands basic > 0, so the fix is a declared basic on
 * the employee record, not a fudged file.
 */
export async function buildWpsPayload(
  runId: string,
  now: Date,
): Promise<{ payload: WpsPayload; month: string } | null> {
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { items: { include: { employee: true } } },
  });
  if (!run) return null;

  const settingsRows = await db.setting.findMany({
    where: {
      key: {
        in: [
          "wpsEmployerEID",
          "wpsPayerEID",
          "wpsPayerQID",
          "wpsPayerBank",
          "wpsPayerIBAN",
          "wpsSifVersion",
        ],
      },
    },
  });
  const s = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));

  const records: WpsEmployeeRecord[] = run.items
    // Only employee-linked payslips can be filed — WPS identity lives there.
    .filter((p) => p.employee)
    .map((p) => {
      const e = p.employee!;
      const advances = toNumber(p.advances);
      const deductions = toNumber(p.deductions) + advances;
      const extraIncome =
        toNumber(p.allowances) +
        toNumber(p.overtime) +
        toNumber(p.extraIncome) +
        toNumber(p.grossCommission);
      return {
        qid: e.qid,
        visaId: e.qid ? null : e.visaId,
        name: e.name,
        bankShortName: e.bankShortName ?? "",
        account: e.iban ?? "",
        salaryFrequency: e.salaryFrequency,
        workingDays: p.workingDays,
        netSalary: toNumber(p.netPaid),
        basicSalary: toNumber(p.basicSalary),
        extraHours: 0,
        extraIncome,
        deductions,
        paymentType: "",
        notes: "",
        housingAllowance: 0,
        foodAllowance: 0,
        transportAllowance: 0,
        overtimeAllowance: toNumber(p.overtime),
        // Advances have their own code; everything else here is working-hours
        // (unpaid leave) or standing deductions.
        deductionReasonCode: deductions === 0 ? "0" : advances > 0 ? "04" : "01",
      };
    });

  const pad = (n: number) => String(n).padStart(2, "0");
  const payload: WpsPayload = {
    employerEID: s.wpsEmployerEID ?? "",
    payerEID: s.wpsPayerEID ?? "",
    payerQID: s.wpsPayerQID ?? "",
    payerBankShortName: s.wpsPayerBank ?? "",
    payerIBAN: s.wpsPayerIBAN ?? "",
    salaryYearMonth: run.month.replace("-", ""),
    fileCreationDate: `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`,
    fileCreationTime: `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`,
    sifVersion: s.wpsSifVersion ?? "1",
    records,
  };
  return { payload, month: run.month };
}
