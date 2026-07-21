import { describe, it, expect } from "vitest";
import {
  generateSif,
  validateSif,
  type WpsPayload,
  type WpsEmployeeRecord,
} from "../../lib/wps/generate";
import { WPS_BANKS } from "../../lib/wps/banks";

const IBAN = "QA87QNBAQAQAXXX00000693123456";

function rec(over: Partial<WpsEmployeeRecord> = {}): WpsEmployeeRecord {
  return {
    qid: "27822001001",
    visaId: null,
    name: "Mustapha Abdullah",
    bankShortName: "DBQ",
    account: "QA26DOHBQAQAXXX00000693123456",
    salaryFrequency: "M",
    workingDays: 30,
    netSalary: 15000,
    basicSalary: 15000,
    extraHours: 0,
    extraIncome: 0,
    deductions: 0,
    paymentType: "",
    notes: "",
    housingAllowance: 0,
    foodAllowance: 0,
    transportAllowance: 0,
    overtimeAllowance: 0,
    deductionReasonCode: "0",
    ...over,
  };
}

function payload(records: WpsEmployeeRecord[]): WpsPayload {
  return {
    employerEID: "10007230",
    payerEID: "44332211",
    payerQID: "",
    payerBankShortName: "QNB",
    payerIBAN: IBAN,
    salaryYearMonth: "202009",
    fileCreationDate: "20200921",
    fileCreationTime: "1849",
    sifVersion: "1",
    records,
  };
}

describe("generateSif — the manual's own example, reproduced", () => {
  it("file name follows SIF_{EID}_{bank}_{yyyyMMdd}_{hhmm}.csv", () => {
    const { fileName } = generateSif(payload([rec()]));
    expect(fileName).toBe("SIF_10007230_QNB_20200921_1849.csv");
  });

  it("row layout: titles, header values, record titles, then records", () => {
    const { content } = generateSif(payload([rec()]));
    const lines = content.split("\r\n");
    expect(lines[0].startsWith("Employer EID,File Creation Date")).toBe(true);
    expect(lines[1]).toBe(
      "10007230,20200921,1849,44332211,,QNB,QA87QNBAQAQAXXX00000693123456,202009,15000,1,1",
    );
    expect(lines[2].startsWith("Record Sequence,Employee QID")).toBe(true);
    expect(lines[3].startsWith("000001,27822001001,,Mustapha Abdullah,DBQ,")).toBe(true);
  });

  it("reproduces the manual's deduction row shape (record 2 of the example)", () => {
    const { content } = generateSif(
      payload([
        rec({
          qid: "28040000056",
          name: "Jalal Oelberg",
          workingDays: 20,
          netSalary: 16000,
          basicSalary: 24000,
          deductions: 8000,
          notes: "Deductions due to sick leave",
          deductionReasonCode: "03",
        }),
      ]),
    );
    const row = content.split("\r\n")[3];
    expect(row).toBe(
      "000001,28040000056,,Jalal Oelberg,DBQ,QA26DOHBQAQAXXX00000693123456,M,20,16000,24000,0,0,8000,,Deductions due to sick leave,0,0,0,0,03,,",
    );
  });

  it("a visa-ID-only employee leaves the QID column blank", () => {
    const { content } = generateSif(
      payload([rec({ qid: null, visaId: "222225522612", name: "Aleksandr Popov" })]),
    );
    expect(content.split("\r\n")[3].startsWith("000001,,222225522612,Aleksandr Popov")).toBe(true);
  });

  it("totals reconcile: header carries the sum and the count", () => {
    const { content, totalSalaries, recordCount } = generateSif(
      payload([rec({ netSalary: 15000 }), rec({ qid: "28424002333", netSalary: 30000 })]),
    );
    expect(totalSalaries).toBe(45000);
    expect(recordCount).toBe(2);
    expect(content.split("\r\n")[1]).toContain(",45000,2,1");
  });

  it("sequences are zero-padded to six digits", () => {
    const records = Array.from({ length: 12 }, (_, i) =>
      rec({ qid: String(27822001001 + i) }),
    );
    const lines = generateSif(payload(records)).content.split("\r\n");
    expect(lines[3].slice(0, 6)).toBe("000001");
    expect(lines[14].slice(0, 6)).toBe("000012");
  });
});

describe("generateSif — CSV integrity", () => {
  it("quotes a name containing a comma and doubles embedded quotes", () => {
    const { content } = generateSif(
      payload([rec({ name: 'Al-Sayed, Ahmed "Abu Ali"' })]),
    );
    expect(content).toContain('"Al-Sayed, Ahmed ""Abu Ali"""');
  });

  it("passes Arabic names through untouched", () => {
    const { content } = generateSif(payload([rec({ name: "محمد عبد الله القرني" })]));
    expect(content).toContain("محمد عبد الله القرني");
  });

  it("uses CRLF line endings throughout and ends with one", () => {
    const { content } = generateSif(payload([rec()]));
    expect(content.endsWith("\r\n")).toBe(true);
    expect(content.split("\r\n").length).toBe(5); // 4 rows + trailing empty
  });

  it("writes decimals plainly — 20.5 extra hours, no separators, no -0", () => {
    const { content } = generateSif(
      payload([rec({ extraHours: 20.5, netSalary: 25000.0 })]),
    );
    const row = content.split("\r\n")[3];
    expect(row).toContain(",20.5,");
    expect(row).toContain(",25000,");
    expect(row).not.toContain("-0");
  });

  it("is deterministic — identical bytes for identical payloads", () => {
    const a = generateSif(payload([rec()]));
    const b = generateSif(payload([rec()]));
    expect(a.content).toBe(b.content);
    expect(a.fileName).toBe(b.fileName);
  });
});

describe("validateSif — every blocking rule has a failing case", () => {
  const ok = () => payload([rec()]);

  it("accepts the golden payload", () => {
    expect(validateSif(ok()).filter((i) => i.severity === "error")).toEqual([]);
  });

  const cases: [string, () => WpsPayload, string][] = [
    ["both payer EID and QID", () => ({ ...ok(), payerQID: "12345678901" }), "payer"],
    ["neither payer EID nor QID", () => ({ ...ok(), payerEID: "" }), "payer"],
    ["short payer IBAN", () => ({ ...ok(), payerIBAN: "QA123" }), "payerIBAN"],
    ["bad month", () => ({ ...ok(), salaryYearMonth: "2020-09" }), "salaryYearMonth"],
    ["no records", () => ({ ...ok(), records: [] }), "records"],
    ["both QID and visa", () => payload([rec({ visaId: "222225522612" })]), "qid"],
    ["neither QID nor visa", () => payload([rec({ qid: null })]), "qid"],
    ["10-digit QID", () => payload([rec({ qid: "2782200100" })]), "qid"],
    ["zero basic salary", () => payload([rec({ basicSalary: 0 })]), "basicSalary"],
    ["negative net", () => payload([rec({ netSalary: -1 })]), "netSalary"],
    ["missing working days", () => payload([rec({ workingDays: null })]), "workingDays"],
    ["name over 70 chars", () => payload([rec({ name: "x".repeat(71) })]), "name"],
    ["missing account", () => payload([rec({ account: "" })]), "account"],
    ["malformed QA IBAN", () => payload([rec({ account: "QA00SHORT" })]), "account"],
    [
      "deductions without reason code",
      () => payload([rec({ deductions: 100, deductionReasonCode: "0" })]),
      "deductionReasonCode",
    ],
    [
      "reason 99 without notes",
      () => payload([rec({ deductions: 100, deductionReasonCode: "99", notes: "" })]),
      "notes",
    ],
    [
      "mixed salary frequencies",
      () =>
        payload([rec(), rec({ qid: "28424002333", salaryFrequency: "B" })]),
      "salaryFrequency",
    ],
  ];

  for (const [label, make, key] of cases) {
    it(`blocks: ${label}`, () => {
      const errors = validateSif(make()).filter((i) => i.severity === "error");
      expect(errors.map((e) => e.key)).toContain(key);
    });
  }
});

describe("bank registry", () => {
  it("carries the Appendix B codes, all ≤4 chars and unique", () => {
    const codes = WPS_BANKS.map((b) => b.code);
    expect(codes).toContain("QNB");
    expect(codes).toContain("CBQ");
    expect(codes).toContain("DBQ");
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c.length).toBeLessThanOrEqual(4);
  });
});
