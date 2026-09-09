import { describe, expect, it } from "vitest";
import { studentSpecialPrice } from "@/lib/special-price";

describe("student special-price teacher scope", () => {
  it("uses the matrix when no special price exists", () => {
    expect(studentSpecialPrice(null, [], "teacher-1")).toBeNull();
  });

  it("applies an unscoped special price to every teacher", () => {
    expect(studentSpecialPrice(125, [], "teacher-1")).toBe(125);
    expect(studentSpecialPrice(125, undefined, "teacher-2")).toBe(125);
  });

  it("applies a scoped price only to an eligible teacher", () => {
    expect(studentSpecialPrice(125, ["teacher-1", "teacher-2"], "teacher-2")).toBe(125);
    expect(studentSpecialPrice(125, ["teacher-1", "teacher-2"], "teacher-3")).toBeNull();
  });
});
