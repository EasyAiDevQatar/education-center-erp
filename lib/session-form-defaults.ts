export type SessionDefaultStudent = {
  id: string;
  gradeLevelId: string | null;
  studyLocation?: "CENTER" | "HOME";
};

/**
 * Resolve the student-dependent defaults for a new session.
 *
 * Callers may pass an id from a profile or planner, but only an id present in
 * the supplied active options is trusted. This keeps a stale profile button
 * from displaying one student while posting another, and keeps grade/location
 * in step with the student selected by the host screen.
 */
export function resolveSessionStudentDefaults(
  students: SessionDefaultStudent[],
  defaultStudentId?: string,
  defaultLocation?: "CENTER" | "HOME",
) {
  const student = defaultStudentId
    ? students.find((option) => option.id === defaultStudentId)
    : undefined;

  return {
    studentId: student?.id ?? "",
    gradeLevelId: student?.gradeLevelId ?? "",
    location: defaultLocation ?? student?.studyLocation ?? "CENTER",
  } as const;
}
