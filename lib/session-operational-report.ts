import {
  groupOccurrenceKeys,
  sessionOccurrenceKey,
  type GroupableSession,
} from "./session-grouping";

const KNOWN_STATUSES = [
  "SCHEDULED",
  "CHECKED_IN",
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED",
] as const;

export type OperationalSessionInput = GroupableSession & {
  id: string;
  status: string;
  teacher?: { name: string } | null;
};

export type DailySessionTrendRow = {
  date: string;
  /** Teaching occurrences. A group lesson counts once, regardless of class size. */
  sessions: number;
  /** Per-student session rows, useful for measuring attendance/seat volume. */
  studentBookings: number;
  /** Cancelled child rows, including cancellations inside an otherwise active group. */
  cancelledStudentBookings: number;
  groupSessions: number;
  individualSessions: number;
  plannedHours: number;
  scheduled: number;
  checkedIn: number;
  completed: number;
  noShow: number;
  cancelled: number;
};

export type SessionStatusBreakdownRow = {
  status: string;
  /** Occurrences whose overall operational status resolves to this status. */
  sessions: number;
  /** Individual student rows carrying this status. */
  studentBookings: number;
  sessionPercentage: number;
  studentBookingPercentage: number;
};

export type TeacherWorkloadRow = {
  teacherId: string | null;
  teacherName: string | null;
  sessions: number;
  studentBookings: number;
  plannedHours: number;
};

export type LocationSessionRow = {
  location: string;
  sessions: number;
  studentBookings: number;
  plannedHours: number;
};

export type BookingTypeSessionRow = {
  type: "INDIVIDUAL" | "GROUP";
  sessions: number;
  studentBookings: number;
  plannedHours: number;
  sessionPercentage: number;
};

export type DailySessionReport = {
  summary: {
    sessions: number;
    studentBookings: number;
    cancelledSessions: number;
    cancelledStudentBookings: number;
    groupSessions: number;
    individualSessions: number;
    plannedHours: number;
  };
  dailyTrend: DailySessionTrendRow[];
  statusBreakdown: SessionStatusBreakdownRow[];
  teacherWorkload: TeacherWorkloadRow[];
  locations: LocationSessionRow[];
  bookingTypes: BookingTypeSessionRow[];
};

/** Backwards-friendly descriptive alias for non-daily consumers. */
export type SessionOperationalAnalytics = DailySessionReport;

export type DailyTrendRange = {
  /** Inclusive YYYY-MM-DD boundary. Supplying boundaries also fills empty days. */
  from?: string;
  /** Inclusive YYYY-MM-DD boundary. Supplying boundaries also fills empty days. */
  to?: string;
};

type Occurrence = {
  date: string;
  status: string;
  isGroup: boolean;
  plannedHours: number;
  members: OperationalSessionInput[];
};

function finiteNumber(value: GroupableSession["hours"]): number {
  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentage(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
}

/**
 * Resolve a group parent to one operational state while retaining each child's
 * own state separately in `statusBreakdown.studentBookings`.
 *
 * Active check-in wins. Otherwise, any completed child means the class ran;
 * a still-scheduled child keeps the occurrence scheduled; no-show beats a
 * cancellation, and only an entirely cancelled occurrence resolves cancelled.
 */
function occurrenceStatus(members: OperationalSessionInput[]): string {
  const statuses = new Set(members.map((member) => member.status));
  if (statuses.has("CHECKED_IN")) return "CHECKED_IN";
  if (statuses.has("COMPLETED")) return "COMPLETED";
  if (statuses.has("SCHEDULED")) return "SCHEDULED";
  if (statuses.has("NO_SHOW")) return "NO_SHOW";
  if (statuses.has("CANCELLED")) return "CANCELLED";
  return [...statuses].sort()[0] ?? "UNKNOWN";
}

function collapseOccurrences(rows: OperationalSessionInput[]): Occurrence[] {
  // Drafts are tentative planner entries, not operational sessions.
  const sessions = rows.filter((row) => row.status !== "DRAFT");
  const groupKeys = groupOccurrenceKeys(sessions);
  const buckets = new Map<string, OperationalSessionInput[]>();

  for (const session of sessions) {
    const candidate = sessionOccurrenceKey(session);
    const key = groupKeys.has(candidate) ? candidate : `session:${session.id}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(session);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()].map(([key, members]) => ({
    date: members
      .map((member) => member.date.toISOString().slice(0, 10))
      .sort()[0],
    status: occurrenceStatus(members),
    isGroup: groupKeys.has(key),
    // Group members normally share duration. Max is defensive and avoids
    // multiplying teacher workload by the number of students in the class.
    plannedHours: Math.max(0, ...members.map((member) => finiteNumber(member.hours))),
    members,
  }));
}

function blankDay(date: string): DailySessionTrendRow {
  return {
    date,
    sessions: 0,
    studentBookings: 0,
    cancelledStudentBookings: 0,
    groupSessions: 0,
    individualSessions: 0,
    plannedHours: 0,
    scheduled: 0,
    checkedIn: 0,
    completed: 0,
    noShow: 0,
    cancelled: 0,
  };
}

function parseDay(value?: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const day = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value
    ? null
    : day;
}

function eachDay(from: string, to: string): string[] {
  const start = parseDay(from);
  const end = parseDay(to);
  if (!start || !end || start > end) return [];
  const days: string[] = [];
  for (let day = start; day <= end; day = new Date(day.getTime() + 86_400_000)) {
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

function statusField(status: string): keyof Pick<
  DailySessionTrendRow,
  "scheduled" | "checkedIn" | "completed" | "noShow" | "cancelled"
> | null {
  if (status === "SCHEDULED") return "scheduled";
  if (status === "CHECKED_IN") return "checkedIn";
  if (status === "COMPLETED") return "completed";
  if (status === "NO_SHOW") return "noShow";
  if (status === "CANCELLED") return "cancelled";
  return null;
}

function dailyTrend(
  occurrences: Occurrence[],
  range?: DailyTrendRange,
): DailySessionTrendRow[] {
  const byDate = new Map<string, DailySessionTrendRow>();
  for (const occurrence of occurrences) {
    const row = byDate.get(occurrence.date) ?? blankDay(occurrence.date);
    row.cancelledStudentBookings += occurrence.members.filter(
      (member) => member.status === "CANCELLED",
    ).length;
    if (occurrence.status === "CANCELLED") {
      row.cancelled++;
      byDate.set(occurrence.date, row);
      continue;
    }
    row.sessions++;
    row.studentBookings += occurrence.members.filter(
      (member) => member.status !== "CANCELLED",
    ).length;
    row.plannedHours += occurrence.plannedHours;
    if (occurrence.isGroup) row.groupSessions++;
    else row.individualSessions++;
    const field = statusField(occurrence.status);
    if (field) row[field]++;
    byDate.set(occurrence.date, row);
  }

  const observed = [...byDate.keys()].sort();
  const first = parseDay(range?.from)?.toISOString().slice(0, 10) ?? observed[0];
  const last = parseDay(range?.to)?.toISOString().slice(0, 10) ?? observed.at(-1);
  if (first && last) {
    for (const date of eachDay(first, last)) {
      if (!byDate.has(date)) byDate.set(date, blankDay(date));
    }
  }

  return [...byDate.values()]
    .map((row) => ({ ...row, plannedHours: round(row.plannedHours) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function statusBreakdown(
  occurrences: Occurrence[],
): SessionStatusBreakdownRow[] {
  const counts = new Map<string, { sessions: number; studentBookings: number }>();
  for (const occurrence of occurrences) {
    const parent = counts.get(occurrence.status) ?? { sessions: 0, studentBookings: 0 };
    parent.sessions++;
    counts.set(occurrence.status, parent);
    for (const member of occurrence.members) {
      const child = counts.get(member.status) ?? { sessions: 0, studentBookings: 0 };
      child.studentBookings++;
      counts.set(member.status, child);
    }
  }

  const order = new Map<string, number>(KNOWN_STATUSES.map((status, index) => [status, index]));
  const totalSessions = occurrences.length;
  const totalBookings = occurrences.reduce((sum, occurrence) => sum + occurrence.members.length, 0);
  return [...counts.entries()]
    .map(([status, countsForStatus]) => ({
      status,
      ...countsForStatus,
      sessionPercentage: percentage(countsForStatus.sessions, totalSessions),
      studentBookingPercentage: percentage(countsForStatus.studentBookings, totalBookings),
    }))
    .sort((a, b) => {
      const aOrder = order.get(a.status) ?? KNOWN_STATUSES.length;
      const bOrder = order.get(b.status) ?? KNOWN_STATUSES.length;
      return aOrder - bOrder || a.status.localeCompare(b.status);
    });
}

function teacherWorkload(occurrences: Occurrence[]): TeacherWorkloadRow[] {
  const rows = new Map<string, TeacherWorkloadRow>();
  for (const occurrence of occurrences.filter((item) => item.status !== "CANCELLED")) {
    const teachers = new Map<string, { id: string | null; name: string | null }>();
    const activeMembers = occurrence.members.filter((member) => member.status !== "CANCELLED");
    for (const member of activeMembers) {
      const key = member.teacherId ?? "__unassigned__";
      const existing = teachers.get(key);
      const name = member.teacher?.name?.trim() || null;
      teachers.set(key, {
        id: member.teacherId ?? null,
        name: existing?.name ?? name,
      });
    }
    for (const [key, teacher] of teachers) {
      const current = rows.get(key) ?? {
        teacherId: teacher.id,
        teacherName: teacher.name,
        sessions: 0,
        studentBookings: 0,
        plannedHours: 0,
      };
      current.sessions++;
      current.studentBookings += activeMembers.filter(
        (member) => (member.teacherId ?? "__unassigned__") === key,
      ).length;
      current.plannedHours += occurrence.plannedHours;
      rows.set(key, current);
    }
  }
  return [...rows.values()]
    .map((row) => ({ ...row, plannedHours: round(row.plannedHours) }))
    .sort((a, b) => {
      const bySessions = b.sessions - a.sessions;
      if (bySessions) return bySessions;
      if (a.teacherId === null && b.teacherId !== null) return 1;
      if (a.teacherId !== null && b.teacherId === null) return -1;
      return (a.teacherName ?? "").localeCompare(b.teacherName ?? "");
    });
}

function locationBreakdown(occurrences: Occurrence[]): LocationSessionRow[] {
  const rows = new Map<string, LocationSessionRow>();
  for (const occurrence of occurrences.filter((item) => item.status !== "CANCELLED")) {
    const activeMembers = occurrence.members.filter((member) => member.status !== "CANCELLED");
    const locations = new Set(activeMembers.map((member) => member.location));
    for (const location of locations) {
      const current = rows.get(location) ?? {
        location,
        sessions: 0,
        studentBookings: 0,
        plannedHours: 0,
      };
      current.sessions++;
      current.studentBookings += activeMembers.filter(
        (member) => member.location === location,
      ).length;
      current.plannedHours += occurrence.plannedHours;
      rows.set(location, current);
    }
  }
  return [...rows.values()]
    .map((row) => ({ ...row, plannedHours: round(row.plannedHours) }))
    .sort((a, b) => b.sessions - a.sessions || a.location.localeCompare(b.location));
}

function bookingTypeBreakdown(occurrences: Occurrence[]): BookingTypeSessionRow[] {
  const active = occurrences.filter((occurrence) => occurrence.status !== "CANCELLED");
  const total = active.length;
  return (["INDIVIDUAL", "GROUP"] as const).map((type) => {
    const matching = active.filter(
      (occurrence) => occurrence.isGroup === (type === "GROUP"),
    );
    return {
      type,
      sessions: matching.length,
      studentBookings: matching.reduce(
        (sum, occurrence) =>
          sum + occurrence.members.filter((member) => member.status !== "CANCELLED").length,
        0,
      ),
      plannedHours: round(
        matching.reduce((sum, occurrence) => sum + occurrence.plannedHours, 0),
      ),
      sessionPercentage: percentage(matching.length, total),
    };
  });
}

/**
 * Build all operational session report datasets in one pass-ready, UI-neutral
 * shape. The input deliberately mirrors a small Prisma `session.findMany`
 * selection, while this module remains pure and independently testable.
 */
export function buildSessionOperationalAnalytics(
  rows: OperationalSessionInput[],
  range?: DailyTrendRange,
): DailySessionReport {
  const occurrences = collapseOccurrences(rows);
  const active = occurrences.filter((occurrence) => occurrence.status !== "CANCELLED");
  const groupSessions = active.filter((occurrence) => occurrence.isGroup).length;
  return {
    summary: {
      sessions: active.length,
      studentBookings: active.reduce(
        (sum, occurrence) =>
          sum + occurrence.members.filter((member) => member.status !== "CANCELLED").length,
        0,
      ),
      cancelledSessions: occurrences.length - active.length,
      cancelledStudentBookings: occurrences.reduce(
        (sum, occurrence) =>
          sum + occurrence.members.filter((member) => member.status === "CANCELLED").length,
        0,
      ),
      groupSessions,
      individualSessions: active.length - groupSessions,
      plannedHours: round(
        active.reduce((sum, occurrence) => sum + occurrence.plannedHours, 0),
      ),
    },
    dailyTrend: dailyTrend(occurrences, range),
    statusBreakdown: statusBreakdown(occurrences),
    teacherWorkload: teacherWorkload(occurrences),
    locations: locationBreakdown(occurrences),
    bookingTypes: bookingTypeBreakdown(occurrences),
  };
}
