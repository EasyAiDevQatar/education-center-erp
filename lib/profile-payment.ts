import type { PayableSession } from "./allocation";

/** Scope a live outstanding balance to one student's sessions in this profile. */
export function profilePayableSessions(
  outstanding: PayableSession[],
  rows: { id: string; studentId: string }[],
  studentId: string,
) {
  const ids = new Set(rows.filter((row) => row.studentId === studentId).map((row) => row.id));
  return outstanding.filter((session) => ids.has(session.id) && session.outstanding > 0.005);
}
