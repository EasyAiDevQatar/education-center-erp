import { describe, expect, it } from "vitest";
import { resolveSessionStudentDefaults } from "@/lib/session-form-defaults";

const students = [
  { id: "student-home", gradeLevelId: "secondary", studyLocation: "HOME" as const },
  { id: "student-center", gradeLevelId: null, studyLocation: "CENTER" as const },
];

describe("session form profile defaults", () => {
  it("preselects a valid student with that student's grade and usual location", () => {
    expect(resolveSessionStudentDefaults(students, "student-home")).toEqual({
      studentId: "student-home",
      gradeLevelId: "secondary",
      location: "HOME",
    });
  });

  it("lets an explicit booking location override the student's usual location", () => {
    expect(resolveSessionStudentDefaults(students, "student-home", "CENTER")).toEqual({
      studentId: "student-home",
      gradeLevelId: "secondary",
      location: "CENTER",
    });
  });

  it("does not trust a stale student id that is absent from the active options", () => {
    expect(resolveSessionStudentDefaults(students, "inactive-student")).toEqual({
      studentId: "",
      gradeLevelId: "",
      location: "CENTER",
    });
  });
});
