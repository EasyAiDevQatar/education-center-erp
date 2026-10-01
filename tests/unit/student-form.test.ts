import { describe, expect, it } from "vitest";

import {
  clearAppliedGuardianHome,
  duplicateStudentDefaults,
  guardianHomeFieldValues,
  preferredGuardianHome,
  type StudentFormDefaults,
} from "@/lib/student-form";

const source: StudentFormDefaults = {
  name: "Existing student",
  nameEn: "Existing Student",
  phone: "5550000",
  gradeLevelId: "secondary",
  gradeYear: 11,
  specialPricePerHour: 125,
  guardianId: "guardian-1",
  studyLocation: "HOME",
  active: false,
  notes: "Student-specific note",
  address: "Family villa",
  homeLat: 25.3,
  homeLng: 51.5,
  checkinPin: "4321",
  homeCode: "V-12",
  teacherIds: ["teacher-1"],
  specialPriceTeacherIds: ["teacher-2"],
};

describe("student duplicate defaults", () => {
  it("copies family, teaching, pricing and home configuration", () => {
    const copy = duplicateStudentDefaults(source);

    expect(copy).toMatchObject({
      guardianId: "guardian-1",
      gradeLevelId: "secondary",
      gradeYear: 11,
      studyLocation: "HOME",
      specialPricePerHour: 125,
      address: "Family villa",
      homeLat: 25.3,
      homeLng: 51.5,
      homeCode: "V-12",
      teacherIds: ["teacher-1"],
      specialPriceTeacherIds: ["teacher-2"],
    });
  });

  it("clears identity, security and history fields and makes a fresh active record", () => {
    const copy = duplicateStudentDefaults(source);

    expect(copy).toMatchObject({
      name: "",
      nameEn: null,
      phone: null,
      notes: null,
      checkinPin: null,
      active: true,
    });
  });

  it("does not alias teacher arrays back to the source row", () => {
    const copy = duplicateStudentDefaults(source);
    copy.teacherIds.push("teacher-3");
    copy.specialPriceTeacherIds.length = 0;

    expect(source.teacherIds).toEqual(["teacher-1"]);
    expect(source.specialPriceTeacherIds).toEqual(["teacher-2"]);
  });
});

describe("preferred guardian home", () => {
  const home = (id: string, isDefault = false) => ({
    id,
    label: id,
    address: null,
    homeCode: null,
    homeLat: null,
    homeLng: null,
    isDefault,
  });

  it("chooses the default even when it is not first", () => {
    expect(preferredGuardianHome([home("first"), home("default", true)])?.id).toBe("default");
  });

  it("falls back to the first home and handles an empty list", () => {
    expect(preferredGuardianHome([home("first"), home("second")])?.id).toBe("first");
    expect(preferredGuardianHome([])).toBeNull();
  });
});

describe("guardian home snapshots", () => {
  it("serializes nullable home fields for controlled form inputs", () => {
    expect(guardianHomeFieldValues({
      id: "home-1",
      label: "Home",
      address: null,
      homeCode: "A-12",
      homeLat: 25.3,
      homeLng: null,
      isDefault: true,
    })).toEqual({ address: "", homeCode: "A-12", lat: "25.3", lng: "" });
  });

  it("clears parent-derived values but retains later manual edits", () => {
    const applied = {
      address: "Parent villa",
      homeCode: "P-1",
      lat: "25.3",
      lng: "51.5",
    };

    expect(clearAppliedGuardianHome({ ...applied, address: "Manually corrected villa" }, applied)).toEqual({
      address: "Manually corrected villa",
      homeCode: "",
      lat: "",
      lng: "",
    });
  });
});
