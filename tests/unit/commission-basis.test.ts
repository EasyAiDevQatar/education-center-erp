import { describe, it, expect } from "vitest";
import {
  COMMISSION_BASES,
  DEFAULT_COMMISSION_BASIS,
  commissionOn,
  isCommissionBasis,
  resolveCommissionBasis,
} from "@/lib/earnings-mode";

// A teacher who taught 5,000 of lessons, of which 3,000 has been collected,
// on 40%: billed commission 2,000, collected commission 1,200.
const c = { expectedCommission: 2000, dueCommission: 1200 };

describe("commission basis", () => {
  it("defaults to collected, so nobody is paid before the parent pays", () => {
    expect(DEFAULT_COMMISSION_BASIS).toBe("COLLECTED");
    expect(commissionOn(DEFAULT_COMMISSION_BASIS, c)).toBe(1200);
  });

  it("pays on what was billed when the centre chooses expected", () => {
    expect(commissionOn("EXPECTED", c)).toBe(2000);
  });

  it("falls back to the default rather than throwing on a stale value", () => {
    for (const v of [null, undefined, "", "collected", "GROSS", "0"]) {
      expect(resolveCommissionBasis(v as string | null)).toBe("COLLECTED");
    }
    expect(resolveCommissionBasis("EXPECTED")).toBe("EXPECTED");
  });

  it("recognises exactly the two bases", () => {
    expect(COMMISSION_BASES).toEqual(["COLLECTED", "EXPECTED"]);
    expect(isCommissionBasis("EXPECTED")).toBe(true);
    expect(isCommissionBasis("expected")).toBe(false);
    expect(isCommissionBasis(undefined)).toBe(false);
  });

  it("agrees with itself when nothing has been collected yet", () => {
    const none = { expectedCommission: 2000, dueCommission: 0 };
    expect(commissionOn("COLLECTED", none)).toBe(0);
    expect(commissionOn("EXPECTED", none)).toBe(2000);
  });
});
