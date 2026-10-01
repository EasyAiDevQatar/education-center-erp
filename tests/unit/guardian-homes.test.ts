import { describe, expect, it } from "vitest";
import {
  MAX_BULK_GUARDIAN_STUDENTS,
  MAX_GUARDIAN_HOMES,
  parseBulkGuardianStudents,
  parseGuardianHomes,
  selectGuardianHome,
} from "../../lib/guardian-homes";

describe("guardian homes", () => {
  it("ignores a blank editor row and normalizes exactly one default", () => {
    const result = parseGuardianHomes(
      JSON.stringify([
        { label: "", address: "", homeLat: "", homeLng: "", isDefault: true },
        { id: "home-1", label: "Main", address: "Al Waab", isDefault: true },
        { id: "home-2", label: "Father", homeLat: "25.25", homeLng: "51.52", isDefault: true },
      ]),
    );

    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: "home-1",
          label: "Main",
          address: "Al Waab",
          homeCode: null,
          homeLat: null,
          homeLng: null,
          isDefault: true,
        },
        {
          id: "home-2",
          label: "Father",
          address: null,
          homeCode: null,
          homeLat: 25.25,
          homeLng: 51.52,
          isDefault: false,
        },
      ],
    });
  });

  it("uses the first populated home when no default is selected", () => {
    const result = parseGuardianHomes(
      JSON.stringify([
        { label: "Main", address: "Doha", isDefault: false },
        { label: "Weekend", address: "Al Khor", isDefault: false },
      ]),
    );
    expect(result.ok && result.value.map((home) => home.isDefault)).toEqual([true, false]);
  });

  it("rejects partial map pins and unlabeled homes", () => {
    expect(
      parseGuardianHomes(JSON.stringify([{ label: "Main", homeLat: 25.2, homeLng: "" }])),
    ).toEqual({ ok: false, error: "invalid" });
    expect(
      parseGuardianHomes(JSON.stringify([{ label: "", address: "Doha" }])),
    ).toEqual({ ok: false, error: "invalid" });
  });

  it("limits the number of homes", () => {
    const homes = Array.from({ length: MAX_GUARDIAN_HOMES + 1 }, (_, index) => ({
      label: `Home ${index}`,
      address: "Doha",
    }));
    expect(parseGuardianHomes(JSON.stringify(homes))).toEqual({ ok: false, error: "tooMany" });
  });

  it("selects only a home owned by the loaded guardian", () => {
    const homes = [
      { id: "first", isDefault: false },
      { id: "default", isDefault: true },
    ];
    expect(selectGuardianHome(homes, null)).toEqual({ ok: true, value: homes[1] });
    expect(selectGuardianHome(homes, "first")).toEqual({ ok: true, value: homes[0] });
    expect(selectGuardianHome(homes, "another-family-home")).toEqual({
      ok: false,
      error: "invalidHome",
    });
  });
});

describe("guardian bulk students", () => {
  it("normalizes valid rows and ignores fully blank rows", () => {
    const result = parseBulkGuardianStudents(
      JSON.stringify([
        { name: "  مريم  ", nameEn: " Maryam ", gradeLevelId: "grade-1", gradeYear: "4" },
        { name: "", nameEn: "", gradeLevelId: "", gradeYear: "" },
      ]),
    );
    expect(result).toEqual({
      ok: true,
      value: [
        { name: "مريم", nameEn: "Maryam", gradeLevelId: "grade-1", gradeYear: 4 },
      ],
    });
  });

  it("rejects a partially completed row without an Arabic name", () => {
    expect(
      parseBulkGuardianStudents(
        JSON.stringify([{ name: "", nameEn: "Mariam", gradeLevelId: "", gradeYear: "" }]),
      ),
    ).toEqual({ ok: false, error: "invalid" });
  });

  it("requires at least one student and caps a bulk operation", () => {
    expect(parseBulkGuardianStudents("[]")).toEqual({ ok: false, error: "noStudents" });
    const rows = Array.from({ length: MAX_BULK_GUARDIAN_STUDENTS + 1 }, (_, index) => ({
      name: `Student ${index}`,
    }));
    expect(parseBulkGuardianStudents(JSON.stringify(rows))).toEqual({
      ok: false,
      error: "tooMany",
    });
  });
});
