import { describe, it, expect } from "vitest";
import { parseGrade, priceFromMatrix, type PriceMatrix } from "@/lib/grade";
import { toNumber, formatMoney, formatHours } from "@/lib/money";

describe("parseGrade", () => {
  it("parses level + center/home location", () => {
    expect(parseGrade("ث مركز")).toEqual({ level: "ث", location: "CENTER" });
    expect(parseGrade("ب بيت")).toEqual({ level: "ب", location: "HOME" });
  });
  it("handles multi-word level codes (ب م)", () => {
    expect(parseGrade("ب م مركز")).toEqual({ level: "ب م", location: "CENTER" });
  });
  it("returns null for empty or unrecognized values", () => {
    expect(parseGrade("")).toBeNull();
    expect(parseGrade(null)).toBeNull();
    expect(parseGrade("ث")).toBeNull();
    expect(parseGrade("ث unknown")).toBeNull();
  });
});

describe("priceFromMatrix", () => {
  // Mirrors the Excel matrix seeded in prisma/seed.ts.
  const matrix: PriceMatrix = {
    primaryBasic: { CENTER: 100, HOME: null },
    primary: { CENTER: 125, HOME: 150 },
    prep: { CENTER: 150, HOME: 175 },
    secondary: { CENTER: 175, HOME: 200 },
    university: { CENTER: 200, HOME: 250 },
  };

  it("resolves each level x location to the expected price", () => {
    expect(priceFromMatrix(matrix, "secondary", "CENTER")).toBe(175);
    expect(priceFromMatrix(matrix, "secondary", "HOME")).toBe(200);
    expect(priceFromMatrix(matrix, "primary", "CENTER")).toBe(125);
    expect(priceFromMatrix(matrix, "university", "HOME")).toBe(250);
  });
  it("returns 0 when a rule is missing", () => {
    expect(priceFromMatrix(matrix, "primaryBasic", "HOME")).toBe(0);
    expect(priceFromMatrix(matrix, "nope", "CENTER")).toBe(0);
  });
});

describe("money helpers", () => {
  it("toNumber coerces strings, numbers, null", () => {
    expect(toNumber(175)).toBe(175);
    expect(toNumber("262.5")).toBe(262.5);
    expect(toNumber(null)).toBe(0);
  });
  it("formats money with grouping and hours", () => {
    expect(formatMoney(1212.5)).toBe("1,212.5");
    expect(formatHours(1.5)).toBe("1.5");
  });
});
