import { describe, expect, it } from "vitest";
import { ACCOUNT_CODES } from "@/lib/accounting/coa";
import { isBalanced, linesForChequeEvent } from "@/lib/accounting/posting";

describe("linesForChequeEvent — incoming", () => {
  it("deposit moves cheques-in-hand to clearing", () => {
    const lines = linesForChequeEvent({
      direction: "INCOMING",
      toStatus: "DEPOSITED",
      amount: 800,
    })!;
    expect(isBalanced(lines)).toBe(true);
    expect(lines[0]).toMatchObject({ accountCode: ACCOUNT_CODES.chequesInClearing, debit: 800 });
    expect(lines[1]).toMatchObject({ accountCode: ACCOUNT_CODES.chequesInHand, credit: 800 });
  });

  it("clearing after deposit lands the bank from 1040", () => {
    const lines = linesForChequeEvent({
      direction: "INCOMING",
      toStatus: "CLEARED",
      amount: 800,
      wasDeposited: true,
    })!;
    expect(isBalanced(lines)).toBe(true);
    expect(lines[0]).toMatchObject({ accountCode: ACCOUNT_CODES.bank, debit: 800 });
    expect(lines[1]).toMatchObject({ accountCode: ACCOUNT_CODES.chequesInClearing, credit: 800 });
  });

  it("clearing without a deposit hop empties 1030 directly", () => {
    const lines = linesForChequeEvent({
      direction: "INCOMING",
      toStatus: "CLEARED",
      amount: 800,
      wasDeposited: false,
    })!;
    expect(lines[1]).toMatchObject({ accountCode: ACCOUNT_CODES.chequesInHand, credit: 800 });
  });

  it("bounce posts only the fee — the principal is unwound by the action", () => {
    expect(
      linesForChequeEvent({ direction: "INCOMING", toStatus: "BOUNCED", amount: 800 }),
    ).toBeNull();
    const withFee = linesForChequeEvent({
      direction: "INCOMING",
      toStatus: "BOUNCED",
      amount: 800,
      bounceFee: 100,
    })!;
    expect(isBalanced(withFee)).toBe(true);
    expect(withFee[0]).toMatchObject({ accountCode: ACCOUNT_CODES.miscExpense, debit: 100 });
    expect(withFee[1]).toMatchObject({ accountCode: ACCOUNT_CODES.bank, credit: 100 });
  });

  it("received/cancelled/void post nothing", () => {
    for (const toStatus of ["RECEIVED", "CANCELLED", "VOID", "REPLACED"]) {
      expect(linesForChequeEvent({ direction: "INCOMING", toStatus, amount: 800 })).toBeNull();
    }
  });
});

describe("linesForChequeEvent — outgoing", () => {
  it("clearing settles cheques-issued from the bank", () => {
    const lines = linesForChequeEvent({
      direction: "OUTGOING",
      toStatus: "CLEARED",
      amount: 1500,
    })!;
    expect(isBalanced(lines)).toBe(true);
    expect(lines[0]).toMatchObject({ accountCode: ACCOUNT_CODES.chequesIssued, debit: 1500 });
    expect(lines[1]).toMatchObject({ accountCode: ACCOUNT_CODES.bank, credit: 1500 });
  });

  it("issue/deposit/bounce post nothing here", () => {
    for (const toStatus of ["RECEIVED", "DEPOSITED", "BOUNCED", "CANCELLED"]) {
      expect(linesForChequeEvent({ direction: "OUTGOING", toStatus, amount: 1500 })).toBeNull();
    }
  });
});
