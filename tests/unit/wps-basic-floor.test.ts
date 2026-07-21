import { describe, it, expect } from "vitest";
import { applyBasicFloor } from "../../lib/wps/basic-floor";

describe("applyBasicFloor", () => {
  it("relabels commission into basic up to the floor", () => {
    // A commission-only tutor: 3500 earned, floor 2000 → 2000 basic + 1500 extra.
    const r = applyBasicFloor({ basicSalary: 0, extraIncome: 3500 }, 2000);
    expect(r).toEqual({ basicSalary: 2000, extraIncome: 1500 });
  });

  it("never invents money: below-floor earnings become all basic, zero extra", () => {
    // Earned 1500 against a 2000 floor — the file claims 1500 basic, not 2000
    // with a phantom deduction.
    const r = applyBasicFloor({ basicSalary: 0, extraIncome: 1500 }, 2000);
    expect(r).toEqual({ basicSalary: 1500, extraIncome: 0 });
  });

  it("preserves the gross under every input", () => {
    for (const [b, e, f] of [
      [0, 3500, 2000],
      [500, 1000, 2000],
      [4000, 700, 2000],
      [0, 0, 2000],
      [123.45, 678.9, 500],
    ] as const) {
      const r = applyBasicFloor({ basicSalary: b, extraIncome: e }, f);
      expect(r.basicSalary + r.extraIncome).toBeCloseTo(b + e, 2);
      expect(r.extraIncome).toBeGreaterThanOrEqual(0);
    }
  });

  it("never reduces a real declared basic already at or above the floor", () => {
    const r = applyBasicFloor({ basicSalary: 4000, extraIncome: 700 }, 2000);
    expect(r).toEqual({ basicSalary: 4000, extraIncome: 700 });
  });

  it("tops up a small real basic from extra income", () => {
    // Basic 500 declared, 1000 commission, floor 2000 → 1500 basic (all there
    // is), 0 extra. The floor is a target, not a fabrication.
    const r = applyBasicFloor({ basicSalary: 500, extraIncome: 1000 }, 2000);
    expect(r).toEqual({ basicSalary: 1500, extraIncome: 0 });
  });

  it("a floor of zero or less is a no-op", () => {
    const input = { basicSalary: 0, extraIncome: 3500 };
    expect(applyBasicFloor(input, 0)).toEqual(input);
    expect(applyBasicFloor(input, -5)).toEqual(input);
    expect(applyBasicFloor(input, NaN)).toEqual(input);
  });

  it("zero earnings stay zero — the validator still refuses them", () => {
    // No relabeling can conjure a positive basic from nothing; such a record
    // must keep failing WPS validation rather than filing an invented wage.
    const r = applyBasicFloor({ basicSalary: 0, extraIncome: 0 }, 2000);
    expect(r).toEqual({ basicSalary: 0, extraIncome: 0 });
  });
});
