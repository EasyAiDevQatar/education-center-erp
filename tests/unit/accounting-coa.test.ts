import { describe, expect, it } from "vitest";
import {
  ACCOUNT_CODES,
  DEFAULT_ACCOUNTS,
  normalSide,
  type AccountType,
} from "@/lib/accounting/coa";

describe("default chart of accounts", () => {
  it("has unique codes", () => {
    const codes = DEFAULT_ACCOUNTS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("uses only valid types", () => {
    const valid = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];
    for (const a of DEFAULT_ACCOUNTS) expect(valid).toContain(a.type);
  });

  it("codes sit in the block matching their type", () => {
    const blockOf: Record<string, AccountType> = {
      "1": "ASSET",
      "2": "LIABILITY",
      "3": "EQUITY",
      "4": "INCOME",
      "5": "EXPENSE",
    };
    for (const a of DEFAULT_ACCOUNTS) {
      expect(a.type, `account ${a.code}`).toBe(blockOf[a.code[0]]);
    }
  });

  it("every parentCode points at an existing account of the same type", () => {
    const byCode = new Map(DEFAULT_ACCOUNTS.map((a) => [a.code, a]));
    for (const a of DEFAULT_ACCOUNTS) {
      if (!a.parentCode) continue;
      const parent = byCode.get(a.parentCode);
      expect(parent, `parent of ${a.code}`).toBeDefined();
      expect(parent!.type).toBe(a.type);
    }
  });

  it("every posting-rule code exists in the defaults", () => {
    const codes = new Set(DEFAULT_ACCOUNTS.map((a) => a.code));
    for (const [key, code] of Object.entries(ACCOUNT_CODES)) {
      expect(codes.has(code), `ACCOUNT_CODES.${key} = ${code}`).toBe(true);
    }
  });

  it("has bilingual names on every account", () => {
    for (const a of DEFAULT_ACCOUNTS) {
      expect(a.nameAr.trim().length, a.code).toBeGreaterThan(0);
      expect(a.nameEn.trim().length, a.code).toBeGreaterThan(0);
    }
  });
});

describe("normalSide", () => {
  it("debits grow assets and expenses; credits grow the rest", () => {
    expect(normalSide("ASSET")).toBe("debit");
    expect(normalSide("EXPENSE")).toBe("debit");
    expect(normalSide("LIABILITY")).toBe("credit");
    expect(normalSide("EQUITY")).toBe("credit");
    expect(normalSide("INCOME")).toBe("credit");
  });
});
