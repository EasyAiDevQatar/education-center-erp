// Ledger aggregation: trial balance, per-account statement, simple P&L.
//
// Pure module — takes plain-number rows the page already loaded, returns
// plain rows for rendering. No dates are parsed here; filtering by period is
// the query's job.

import { normalSide, type AccountType } from "./coa";

/** One journal line joined to its account, flattened for aggregation. */
export type LedgerRow = {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debit: number;
  credit: number;
};

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
  /** Net on the account's normal side (positive = normal balance). */
  balance: number;
};

/**
 * Classic trial balance: per-account debit/credit totals. `totalDebit` must
 * equal `totalCredit` whenever every entry was balanced — the report is the
 * daily proof that posting discipline held.
 */
export function trialBalance(rows: LedgerRow[]): {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
} {
  const map = new Map<string, TrialBalanceRow>();
  for (const r of rows) {
    let row = map.get(r.accountId);
    if (!row) {
      row = {
        accountId: r.accountId,
        code: r.accountCode,
        name: r.accountName,
        type: r.accountType,
        debit: 0,
        credit: 0,
        balance: 0,
      };
      map.set(r.accountId, row);
    }
    row.debit += r.debit;
    row.credit += r.credit;
  }
  let totalDebit = 0;
  let totalCredit = 0;
  for (const row of map.values()) {
    row.balance =
      normalSide(row.type) === "debit" ? row.debit - row.credit : row.credit - row.debit;
    totalDebit += row.debit;
    totalCredit += row.credit;
  }
  return {
    rows: [...map.values()].sort((a, b) => a.code.localeCompare(b.code)),
    totalDebit,
    totalCredit,
  };
}

export type StatementInputRow = {
  date: string;
  memo: string;
  debit: number;
  credit: number;
};

export type StatementRow = StatementInputRow & { balance: number };

/**
 * Running balance for one account. Rows must already be in display order
 * (oldest first). The sign convention follows the account's normal side, so a
 * healthy cash account reads positive and a healthy revenue account too.
 */
export function accountStatement(
  rows: StatementInputRow[],
  type: AccountType,
  opening = 0,
): StatementRow[] {
  const side = normalSide(type);
  let balance = opening;
  return rows.map((r) => {
    balance += side === "debit" ? r.debit - r.credit : r.credit - r.debit;
    return { ...r, balance };
  });
}

export type PLRow = { accountId: string; code: string; name: string; amount: number };

/**
 * Income statement over whatever period the rows cover: income accounts by
 * credit-net, expense accounts by debit-net, net = income − expenses.
 * Contra-income (4900 refunds) naturally shows negative.
 */
export function profitAndLoss(rows: LedgerRow[]): {
  income: PLRow[];
  expense: PLRow[];
  totalIncome: number;
  totalExpense: number;
  net: number;
} {
  const income = new Map<string, PLRow>();
  const expense = new Map<string, PLRow>();
  for (const r of rows) {
    if (r.accountType !== "INCOME" && r.accountType !== "EXPENSE") continue;
    const bucket = r.accountType === "INCOME" ? income : expense;
    let row = bucket.get(r.accountId);
    if (!row) {
      row = { accountId: r.accountId, code: r.accountCode, name: r.accountName, amount: 0 };
      bucket.set(r.accountId, row);
    }
    row.amount += r.accountType === "INCOME" ? r.credit - r.debit : r.debit - r.credit;
  }
  const incomeRows = [...income.values()].sort((a, b) => a.code.localeCompare(b.code));
  const expenseRows = [...expense.values()].sort((a, b) => a.code.localeCompare(b.code));
  const totalIncome = incomeRows.reduce((a, r) => a + r.amount, 0);
  const totalExpense = expenseRows.reduce((a, r) => a + r.amount, 0);
  return {
    income: incomeRows,
    expense: expenseRows,
    totalIncome,
    totalExpense,
    net: totalIncome - totalExpense,
  };
}
