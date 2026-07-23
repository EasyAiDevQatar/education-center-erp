// Posting rules: given a source document, build the balanced journal lines.
//
// Pure module — no imports beyond the sibling coa.ts, no "server-only" — this
// is money and must be unit-testable. All amounts are plain numbers (the
// caller converts Prisma Decimals with toNumber at the boundary).
//
// Every builder MUST return a balanced set (sum debit = sum credit); the
// tests enforce it for every branch, and journal-data refuses to write an
// unbalanced draft as the last line of defence.

import { ACCOUNT_CODES } from "./coa";

export type DraftLine = {
  accountCode: string;
  debit: number;
  credit: number;
  memo?: string;
};

export type JournalSource = "PAYMENT" | "EXPENSE" | "PAYROLL" | "CHEQUE" | "MANUAL";

export type DraftEntry = {
  date: Date;
  memo: string;
  sourceType: JournalSource;
  /** Null only for MANUAL entries. */
  sourceId: string | null;
  lines: DraftLine[];
};

/**
 * Money comparisons live on a half-fils epsilon: QAR has 2 decimals, and the
 * inputs came through Decimal→number conversion, so exact equality is a trap.
 */
export function isBalanced(lines: DraftLine[], epsilon = 0.005): boolean {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    if (l.debit < 0 || l.credit < 0) return false;
    // One side only: a leg carrying both is a smeared entry, not a balance.
    if (l.debit > 0 && l.credit > 0) return false;
    debit += l.debit;
    credit += l.credit;
  }
  return Math.abs(debit - credit) < epsilon && debit > 0;
}

/** Which asset account each payment method lands in. */
export const METHOD_ACCOUNT: Record<string, string> = {
  CASH: ACCOUNT_CODES.cash,
  POS: ACCOUNT_CODES.onlineClearing,
  QPAY: ACCOUNT_CODES.onlineClearing,
  TRANSFER: ACCOUNT_CODES.bank,
  CHEQUE: ACCOUNT_CODES.chequesInHand,
};

/** Which account settles each payslip method. */
export const PAYSLIP_METHOD_ACCOUNT: Record<string, string> = {
  CASH: ACCOUNT_CODES.cash,
  BANK: ACCOUNT_CODES.bank,
  CHEQUE: ACCOUNT_CODES.chequesIssued,
};

/**
 * A student payment: money in against tuition revenue. There is no invoice/AR
 * cycle in this system, so payments post straight to revenue — deliberately
 * simple, and it makes the P&L's income line equal actual collections.
 */
export function linesForPayment(p: {
  amount: number;
  method: string;
  receiptNo?: string;
}): DraftLine[] {
  const account = METHOD_ACCOUNT[p.method] ?? ACCOUNT_CODES.cash;
  const memo = p.receiptNo ? `receipt ${p.receiptNo}` : undefined;
  return [
    { accountCode: account, debit: p.amount, credit: 0, memo },
    { accountCode: ACCOUNT_CODES.revenue, debit: 0, credit: p.amount, memo },
  ];
}

/**
 * An expense: cost against cash (or against cheques-issued when settled by an
 * outgoing cheque — the cheque's own clearing hop then moves 2110 → bank).
 * Category mapping may be null; 5900 keeps unmapped spending visible instead
 * of blocking the clerk.
 */
export function linesForExpense(e: {
  amount: number;
  categoryAccountCode: string | null;
  viaCheque?: boolean;
}): DraftLine[] {
  const expenseAccount = e.categoryAccountCode ?? ACCOUNT_CODES.miscExpense;
  const creditAccount = e.viaCheque ? ACCOUNT_CODES.chequesIssued : ACCOUNT_CODES.cash;
  return [
    { accountCode: expenseAccount, debit: e.amount, credit: 0 },
    { accountCode: creditAccount, debit: 0, credit: e.amount },
  ];
}

/**
 * A paid payslip: net salary cost against the settlement account. Net-only by
 * design — the payslip already carries its own breakdown, and mirroring it
 * into the GL would double the surface for drift without adding information.
 */
export function linesForPayslip(p: { net: number; method: string | null }): DraftLine[] {
  const account = PAYSLIP_METHOD_ACCOUNT[p.method ?? "CASH"] ?? ACCOUNT_CODES.cash;
  return [
    { accountCode: ACCOUNT_CODES.salaries, debit: p.net, credit: 0 },
    { accountCode: account, debit: 0, credit: p.net },
  ];
}
