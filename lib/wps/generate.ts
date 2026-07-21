/**
 * Qatar WPS Salary Information File generator — QCB Circular 2020/7 format,
 * transcribed from the official QNB "New WPS file Format" manual (April 2021).
 *
 * File shape (CSV per RFC4180):
 *   row 1: header field titles
 *   row 2: header values
 *   row 3: record field titles
 *   row 4+: one record per employee
 *
 * Name: SIF_{EmployerEID}_{BankShortName}_{yyyyMMdd}_{hhmm}.csv
 *
 * Pure and deterministic: the creation date/time come from the payload, never
 * from the clock in here — that is what makes a stored checksum reproducible
 * and lets the file be regenerated instead of stored.
 */

export type WpsEmployeeRecord = {
  /** Exactly one of qid / visaId must be present. */
  qid: string | null;
  visaId: string | null;
  name: string;
  bankShortName: string;
  /** Account number at the payer's own bank, IBAN elsewhere. */
  account: string;
  /** "M" monthly | "B" bi-weekly. One frequency per file. */
  salaryFrequency: string;
  workingDays: number | null;
  netSalary: number;
  basicSalary: number;
  extraHours: number;
  extraIncome: number;
  deductions: number;
  /** Blank, or one of the four literals from the spec. */
  paymentType: string;
  notes: string;
  housingAllowance: number;
  foodAllowance: number;
  transportAllowance: number;
  overtimeAllowance: number;
  /** 01|02|03|04|99 — mandatory when deductions ≠ 0; 99 requires notes. */
  deductionReasonCode: string;
};

export type WpsPayload = {
  employerEID: string;
  /** Exactly one of payerEID / payerQID. */
  payerEID: string;
  payerQID: string;
  payerBankShortName: string;
  payerIBAN: string;
  /** yyyyMM */
  salaryYearMonth: string;
  /** yyyyMMdd — from the caller, for determinism. */
  fileCreationDate: string;
  /** hhmm */
  fileCreationTime: string;
  sifVersion: string;
  records: WpsEmployeeRecord[];
};

export type WpsIssue = {
  severity: "error" | "warning";
  /** 0-based index into records; absent for header issues. */
  recordIndex?: number;
  key: string;
  message: string;
};

const HEADER_TITLES = [
  "Employer EID",
  "File Creation Date",
  "File Creation Time",
  "Payer EID",
  "Payer QID",
  "Payer Bank Short Name",
  "Payer IBAN",
  "Salary Year and Month",
  "Total Salaries",
  "Total Records",
  "SIF Version",
];

const RECORD_TITLES = [
  "Record Sequence",
  "Employee QID",
  "Employee Visa ID",
  "Employee Name",
  "Employee Bank Short Name",
  "Employee Account",
  "Salary Frequency",
  "Number of Working days",
  "Net Salary",
  "Basic Salary",
  "Extra hours",
  "Extra income",
  "Deductions",
  "Payment Type",
  "Notes / Comments",
  "Housing Allowance",
  "Food Allowance",
  "Transportation Allowance",
  "Over Time Allowance",
  "Deduction Reason Code",
  "Extra Field 1",
  "Extra Field 2",
];

/** RFC4180: quote when the value contains comma, quote, or newline; double
    embedded quotes. The manual additionally says to quote notes containing
    any non-alphanumeric characters — commas and quotes are the ones that
    would corrupt the structure, so those are what we quote on. */
function csvField(v: string): string {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** Amounts: plain decimal, no thousands separators, no trailing zeros forced —
    the manual's own example writes 15000 and 20.5. */
function amount(n: number): string {
  const r = Math.round(n * 100) / 100;
  // Avoid "-0" and exponent notation.
  return (Object.is(r, -0) ? 0 : r).toString();
}

export function validateSif(p: WpsPayload): WpsIssue[] {
  const issues: WpsIssue[] = [];
  const err = (key: string, message: string, recordIndex?: number) =>
    issues.push({ severity: "error", key, message, recordIndex });

  if (!/^\d{7,8}$/.test(p.employerEID)) err("employerEID", "7-8 digits");
  if (!/^\d{8}$/.test(p.fileCreationDate)) err("fileCreationDate", "yyyyMMdd");
  if (!/^\d{4}$/.test(p.fileCreationTime)) err("fileCreationTime", "hhmm");
  // Exactly one of payer EID / QID — the spec is explicit.
  const hasEid = p.payerEID.trim() !== "";
  const hasQid = p.payerQID.trim() !== "";
  if (hasEid === hasQid) err("payer", "exactly one of Payer EID / Payer QID");
  if (hasEid && !/^\d{7,8}$/.test(p.payerEID)) err("payerEID", "7-8 digits");
  if (hasQid && !/^\d{11}$/.test(p.payerQID)) err("payerQID", "11 digits");
  if (!/^[A-Z0-9]{1,4}$/.test(p.payerBankShortName)) err("payerBankShortName", "≤4 chars");
  if (!/^QA\d{2}[A-Z0-9]{25}$/.test(p.payerIBAN)) err("payerIBAN", "Qatari IBAN: QA + 27 (29 total)");
  if (!/^\d{6}$/.test(p.salaryYearMonth)) err("salaryYearMonth", "yyyyMM");
  if (p.records.length === 0) err("records", "no records");

  const freqs = new Set(p.records.map((r) => r.salaryFrequency));
  if (freqs.size > 1) err("salaryFrequency", "one salary frequency per file");

  p.records.forEach((r, i) => {
    const hasEmpQid = !!r.qid?.trim();
    const hasVisa = !!r.visaId?.trim();
    if (hasEmpQid === hasVisa) err("qid", "exactly one of QID / Visa ID", i);
    if (hasEmpQid && !/^\d{11}$/.test(r.qid!)) err("qid", "QID must be 11 digits", i);
    if (hasVisa && r.visaId!.length > 12) err("visaId", "Visa ID max 12", i);
    if (!r.name.trim()) err("name", "name required", i);
    if (r.name.length > 70) err("name", "name max 70 chars", i);
    if (!/^[A-Z0-9]{1,4}$/.test(r.bankShortName)) err("bankShortName", "bank code ≤4 chars", i);
    if (!r.account.trim()) err("account", "account/IBAN required", i);
    if (r.account.length > 29) err("account", "account max 29 chars", i);
    if (r.account.startsWith("QA") && !/^QA\d{2}[A-Z0-9]{25}$/.test(r.account))
      err("account", "malformed Qatari IBAN", i);
    if (r.salaryFrequency !== "M" && r.salaryFrequency !== "B")
      err("salaryFrequency", "M or B", i);
    if (r.workingDays === null) err("workingDays", "working days required", i);
    else if (r.workingDays < 0 || r.workingDays > 999) err("workingDays", "0-999", i);
    // "The basic salary should be more than 0 (zero)."
    if (!(r.basicSalary > 0)) err("basicSalary", "basic salary must be > 0", i);
    if (r.netSalary < 0) err("netSalary", "net salary cannot be negative", i);
    if (r.deductions !== 0 && !/^(01|02|03|04|99)$/.test(r.deductionReasonCode))
      err("deductionReasonCode", "reason code mandatory when deductions ≠ 0", i);
    if (r.deductionReasonCode === "99" && !r.notes.trim())
      err("notes", "notes mandatory for reason code 99", i);
    if (r.notes.length > 300) err("notes", "notes max 300", i);
  });

  return issues;
}

export function generateSif(p: WpsPayload): {
  fileName: string;
  content: string;
  recordCount: number;
  totalSalaries: number;
} {
  const total =
    Math.round(p.records.reduce((n, r) => n + r.netSalary, 0) * 100) / 100;

  const headerValues = [
    p.employerEID,
    p.fileCreationDate,
    p.fileCreationTime,
    p.payerEID,
    p.payerQID,
    p.payerBankShortName,
    p.payerIBAN,
    p.salaryYearMonth,
    amount(total),
    String(p.records.length),
    p.sifVersion,
  ];

  const recordRows = p.records.map((r, i) => [
    // Zero-padded to 6, as in the manual's example (000001).
    String(i + 1).padStart(6, "0"),
    r.qid?.trim() ?? "",
    r.visaId?.trim() ?? "",
    r.name,
    r.bankShortName,
    r.account,
    r.salaryFrequency,
    r.workingDays === null ? "" : String(r.workingDays),
    amount(r.netSalary),
    amount(r.basicSalary),
    amount(r.extraHours),
    amount(r.extraIncome),
    amount(r.deductions),
    r.paymentType,
    r.notes,
    amount(r.housingAllowance),
    amount(r.foodAllowance),
    amount(r.transportAllowance),
    amount(r.overtimeAllowance),
    r.deductions !== 0 ? r.deductionReasonCode : "0",
    "",
    "",
  ]);

  const rows = [HEADER_TITLES, headerValues, RECORD_TITLES, ...recordRows];
  const content = rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";

  const fileName = `SIF_${p.employerEID}_${p.payerBankShortName}_${p.fileCreationDate}_${p.fileCreationTime}.csv`;

  return { fileName, content, recordCount: p.records.length, totalSalaries: total };
}
