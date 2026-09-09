export type ReferenceKind = "student" | "teacher" | "session";

const PREFIX: Record<ReferenceKind, string> = {
  student: "S",
  teacher: "T",
  session: "SE",
};

/** Human-facing stable code. Database counters start at 1; screens start at 1001. */
export function referenceCode(kind: ReferenceKind, referenceNo: number): string {
  return `${PREFIX[kind]}-${String(referenceNo + 1000).padStart(4, "0")}`;
}
