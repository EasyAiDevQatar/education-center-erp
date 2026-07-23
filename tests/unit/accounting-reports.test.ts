import { describe, expect, it } from "vitest";
import {
  accountStatement,
  profitAndLoss,
  trialBalance,
  type LedgerRow,
} from "@/lib/accounting/reports";

const row = (over: Partial<LedgerRow>): LedgerRow => ({
  accountId: "a-cash",
  accountCode: "1000",
  accountName: "Cash",
  accountType: "ASSET",
  debit: 0,
  credit: 0,
  ...over,
});

// A balanced mini-ledger: 300 cash sales, 120 rent paid.
const LEDGER: LedgerRow[] = [
  row({ debit: 300 }),
  row({ accountId: "a-rev", accountCode: "4000", accountName: "Revenue", accountType: "INCOME", credit: 300 }),
  row({ accountId: "a-rent", accountCode: "5300", accountName: "Rent", accountType: "EXPENSE", debit: 120 }),
  row({ credit: 120 }),
];

describe("trialBalance", () => {
  it("totals debits and credits equally for a balanced ledger", () => {
    const tb = trialBalance(LEDGER);
    expect(tb.totalDebit).toBeCloseTo(420);
    expect(tb.totalCredit).toBeCloseTo(420);
  });

  it("nets each account on its normal side", () => {
    const tb = trialBalance(LEDGER);
    const cash = tb.rows.find((r) => r.code === "1000")!;
    const rev = tb.rows.find((r) => r.code === "4000")!;
    expect(cash.balance).toBeCloseTo(180); // 300 in − 120 out, debit-normal
    expect(rev.balance).toBeCloseTo(300); // credit-normal
  });

  it("sorts by code", () => {
    const tb = trialBalance(LEDGER);
    expect(tb.rows.map((r) => r.code)).toEqual(["1000", "4000", "5300"]);
  });

  it("surfaces an unbalanced ledger as unequal totals", () => {
    const tb = trialBalance([row({ debit: 100 })]);
    expect(tb.totalDebit).not.toBe(tb.totalCredit);
  });
});

describe("accountStatement", () => {
  const rows = [
    { date: "2026-01-01", memo: "in", debit: 500, credit: 0 },
    { date: "2026-01-02", memo: "out", debit: 0, credit: 200 },
    { date: "2026-01-03", memo: "in", debit: 50, credit: 0 },
  ];

  it("runs a debit-normal balance", () => {
    const st = accountStatement(rows, "ASSET");
    expect(st.map((r) => r.balance)).toEqual([500, 300, 350]);
  });

  it("runs a credit-normal balance with the signs flipped", () => {
    const st = accountStatement(rows, "INCOME");
    expect(st.map((r) => r.balance)).toEqual([-500, -300, -350]);
  });

  it("starts from the opening balance", () => {
    const st = accountStatement(rows, "ASSET", 1000);
    expect(st[0].balance).toBe(1500);
  });

  it("may go negative — overdrafts are information, not errors", () => {
    const st = accountStatement([{ date: "d", memo: "", debit: 0, credit: 40 }], "ASSET", 10);
    expect(st[0].balance).toBe(-30);
  });
});

describe("profitAndLoss", () => {
  it("net = income − expenses", () => {
    const pl = profitAndLoss(LEDGER);
    expect(pl.totalIncome).toBeCloseTo(300);
    expect(pl.totalExpense).toBeCloseTo(120);
    expect(pl.net).toBeCloseTo(180);
  });

  it("ignores balance-sheet accounts", () => {
    const pl = profitAndLoss(LEDGER);
    const codes = [...pl.income, ...pl.expense].map((r) => r.code);
    expect(codes).not.toContain("1000");
  });

  it("shows contra-income (refunds) as negative income", () => {
    const pl = profitAndLoss([
      row({ accountId: "a-ref", accountCode: "4900", accountName: "Refunds", accountType: "INCOME", debit: 80 }),
    ]);
    expect(pl.income[0].amount).toBeCloseTo(-80);
    expect(pl.net).toBeCloseTo(-80);
  });
});
