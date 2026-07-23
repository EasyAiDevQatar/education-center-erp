import { describe, expect, it } from "vitest";
import { ACCOUNT_CODES } from "@/lib/accounting/coa";
import {
  isBalanced,
  linesForExpense,
  linesForPayment,
  linesForPayslip,
  METHOD_ACCOUNT,
  PAYSLIP_METHOD_ACCOUNT,
} from "@/lib/accounting/posting";

describe("isBalanced", () => {
  it("accepts a matched pair", () => {
    expect(
      isBalanced([
        { accountCode: "1000", debit: 100, credit: 0 },
        { accountCode: "4000", debit: 0, credit: 100 },
      ]),
    ).toBe(true);
  });

  it("rejects an unbalanced set", () => {
    expect(
      isBalanced([
        { accountCode: "1000", debit: 100, credit: 0 },
        { accountCode: "4000", debit: 0, credit: 90 },
      ]),
    ).toBe(false);
  });

  it("rejects a leg carrying both sides", () => {
    expect(isBalanced([{ accountCode: "1000", debit: 50, credit: 50 }])).toBe(false);
  });

  it("rejects negative amounts", () => {
    expect(
      isBalanced([
        { accountCode: "1000", debit: -100, credit: 0 },
        { accountCode: "4000", debit: 0, credit: -100 },
      ]),
    ).toBe(false);
  });

  it("rejects an all-zero entry", () => {
    expect(
      isBalanced([
        { accountCode: "1000", debit: 0, credit: 0 },
        { accountCode: "4000", debit: 0, credit: 0 },
      ]),
    ).toBe(false);
  });

  it("tolerates float dust inside the epsilon and not beyond", () => {
    expect(
      isBalanced([
        { accountCode: "1000", debit: 0.1 + 0.2, credit: 0 },
        { accountCode: "4000", debit: 0, credit: 0.3 },
      ]),
    ).toBe(true);
    expect(
      isBalanced([
        { accountCode: "1000", debit: 100.01, credit: 0 },
        { accountCode: "4000", debit: 0, credit: 100 },
      ]),
    ).toBe(false);
  });
});

describe("linesForPayment", () => {
  it.each([
    ["CASH", ACCOUNT_CODES.cash],
    ["POS", ACCOUNT_CODES.onlineClearing],
    ["QPAY", ACCOUNT_CODES.onlineClearing],
    ["TRANSFER", ACCOUNT_CODES.bank],
    ["CHEQUE", ACCOUNT_CODES.chequesInHand],
  ])("%s debits %s against revenue", (method, account) => {
    const lines = linesForPayment({ amount: 150, method });
    expect(isBalanced(lines)).toBe(true);
    expect(lines).toEqual([
      { accountCode: account, debit: 150, credit: 0, memo: undefined },
      { accountCode: ACCOUNT_CODES.revenue, debit: 0, credit: 150, memo: undefined },
    ]);
  });

  it("falls back to cash on an unknown method rather than dropping money", () => {
    const lines = linesForPayment({ amount: 99, method: "???" });
    expect(lines[0].accountCode).toBe(ACCOUNT_CODES.cash);
    expect(isBalanced(lines)).toBe(true);
  });

  it("carries the receipt number into the memo", () => {
    const lines = linesForPayment({ amount: 10, method: "CASH", receiptNo: "1042" });
    expect(lines[0].memo).toContain("1042");
  });

  it("every mapped method account exists in ACCOUNT_CODES values", () => {
    const known = new Set(Object.values(ACCOUNT_CODES));
    for (const [m, code] of Object.entries(METHOD_ACCOUNT)) {
      expect(known.has(code as (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES]), m).toBe(true);
    }
  });
});

describe("linesForExpense", () => {
  it("debits the category account against cash", () => {
    const lines = linesForExpense({ amount: 200, categoryAccountCode: "5300" });
    expect(isBalanced(lines)).toBe(true);
    expect(lines[0]).toMatchObject({ accountCode: "5300", debit: 200 });
    expect(lines[1]).toMatchObject({ accountCode: ACCOUNT_CODES.cash, credit: 200 });
  });

  it("falls back to 5900 when the category is unmapped", () => {
    const lines = linesForExpense({ amount: 75, categoryAccountCode: null });
    expect(lines[0].accountCode).toBe(ACCOUNT_CODES.miscExpense);
    expect(isBalanced(lines)).toBe(true);
  });

  it("credits cheques-issued when paid by outgoing cheque", () => {
    const lines = linesForExpense({ amount: 500, categoryAccountCode: "5400", viaCheque: true });
    expect(lines[1].accountCode).toBe(ACCOUNT_CODES.chequesIssued);
    expect(isBalanced(lines)).toBe(true);
  });
});

describe("linesForPayslip", () => {
  it.each([
    ["CASH", ACCOUNT_CODES.cash],
    ["BANK", ACCOUNT_CODES.bank],
    ["CHEQUE", ACCOUNT_CODES.chequesIssued],
  ])("%s credits %s against salaries", (method, account) => {
    const lines = linesForPayslip({ net: 3000, method });
    expect(isBalanced(lines)).toBe(true);
    expect(lines[0]).toMatchObject({ accountCode: ACCOUNT_CODES.salaries, debit: 3000 });
    expect(lines[1]).toMatchObject({ accountCode: account, credit: 3000 });
  });

  it("a null method settles as cash — legacy payouts have no method", () => {
    const lines = linesForPayslip({ net: 1200, method: null });
    expect(lines[1].accountCode).toBe(ACCOUNT_CODES.cash);
    expect(isBalanced(lines)).toBe(true);
  });

  it("payslip method map only points at known accounts", () => {
    const known = new Set(Object.values(ACCOUNT_CODES));
    for (const [m, code] of Object.entries(PAYSLIP_METHOD_ACCOUNT)) {
      expect(known.has(code as (typeof ACCOUNT_CODES)[keyof typeof ACCOUNT_CODES]), m).toBe(true);
    }
  });
});
