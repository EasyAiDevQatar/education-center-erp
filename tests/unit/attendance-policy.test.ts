import { describe, it, expect } from "vitest";
import {
  NO_SHOW_POLICIES,
  DEFAULT_NO_SHOW_POLICY,
  isNoShowPolicy,
  noShowIsChargeable,
  resolveNoShowPolicy,
  unbilledStatuses,
} from "@/lib/attendance-policy";

describe("no-show policy", () => {
  it("defaults to cancelled, so an absence is never quietly charged", () => {
    expect(DEFAULT_NO_SHOW_POLICY).toBe("CANCELLED");
    expect(noShowIsChargeable(DEFAULT_NO_SHOW_POLICY)).toBe(false);
  });

  it("charges in full when the centre chooses taught", () => {
    expect(noShowIsChargeable("TAUGHT")).toBe(true);
  });

  it("falls back to cancelled rather than throwing on a stale value", () => {
    for (const v of [null, undefined, "", "cancelled", "BILLED", "1"]) {
      expect(resolveNoShowPolicy(v as string | null)).toBe("CANCELLED");
    }
    expect(resolveNoShowPolicy("TAUGHT")).toBe("TAUGHT");
  });

  it("recognises exactly the two policies", () => {
    expect(NO_SHOW_POLICIES).toEqual(["CANCELLED", "TAUGHT"]);
    expect(isNoShowPolicy("TAUGHT")).toBe(true);
    expect(isNoShowPolicy("taught")).toBe(false);
  });

  it("adds NO_SHOW to a money query only when it earns nothing", () => {
    expect(unbilledStatuses("CANCELLED", ["DRAFT", "CANCELLED"])).toEqual([
      "DRAFT",
      "CANCELLED",
      "NO_SHOW",
    ]);
    expect(unbilledStatuses("TAUGHT", ["DRAFT", "CANCELLED"])).toEqual(["DRAFT", "CANCELLED"]);
  });

  it("keeps each caller's own base list — billing and payroll differ", () => {
    // Payroll excludes only drafts today; this must not smuggle CANCELLED in.
    expect(unbilledStatuses("CANCELLED", ["DRAFT"])).toEqual(["DRAFT", "NO_SHOW"]);
    expect(unbilledStatuses("TAUGHT", ["DRAFT"])).toEqual(["DRAFT"]);
  });

  it("does not mutate the base list it was given", () => {
    const base = ["DRAFT"];
    unbilledStatuses("CANCELLED", base);
    expect(base).toEqual(["DRAFT"]);
  });
});
