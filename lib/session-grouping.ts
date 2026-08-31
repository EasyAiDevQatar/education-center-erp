/** Scheduling fields that identify one per-student row inside a group lesson. */
export type GroupableSession = {
  bookingBatchId?: string | null;
  groupId?: string | null;
  date: Date;
  teacherId?: string | null;
  hours: number | string | { toString(): string };
  location: string;
  createdAt: Date;
};

/**
 * Stable occurrence identity shared by the calendar, daily planner and daily
 * sessions table. New bookings have bookingBatchId; the strict fallbacks keep
 * older saved/ad-hoc group bookings together without merging merely-simultaneous
 * individual lessons.
 */
export function sessionOccurrenceKey(session: GroupableSession): string {
  if (session.bookingBatchId) return `batch:${session.bookingBatchId}`;
  const schedule = `${session.date.toISOString()}:${session.teacherId ?? ""}:${session.hours.toString()}:${session.location}`;
  if (session.groupId) return `legacy:${session.groupId}:${schedule}`;
  return `legacy-batch:${session.createdAt.getTime()}:${schedule}`;
}

/** Explicit identities remain group sessions even if only one active member remains. */
export function hasExplicitGroupIdentity(session: GroupableSession): boolean {
  return Boolean(session.bookingBatchId || session.groupId);
}

/** Candidate keys that represent real group occurrences within the supplied rows. */
export function groupOccurrenceKeys<T extends GroupableSession>(sessions: T[]): Set<string> {
  const counts = new Map<string, number>();
  const explicit = new Set<string>();
  for (const session of sessions) {
    const key = sessionOccurrenceKey(session);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (hasExplicitGroupIdentity(session)) explicit.add(key);
  }
  return new Set(
    [...counts]
      .filter(([key, count]) => count > 1 || explicit.has(key))
      .map(([key]) => key),
  );
}

