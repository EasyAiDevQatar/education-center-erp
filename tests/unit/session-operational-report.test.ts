import { describe, expect, it } from "vitest";
import {
  buildSessionOperationalAnalytics,
  type OperationalSessionInput,
} from "@/lib/session-operational-report";

function session(
  id: string,
  patch: Partial<OperationalSessionInput> = {},
): OperationalSessionInput {
  return {
    id,
    date: new Date("2026-09-01T10:00:00.000Z"),
    status: "SCHEDULED",
    teacherId: "teacher-a",
    teacher: { name: "Aisha" },
    hours: 1,
    location: "CENTER",
    bookingBatchId: null,
    groupId: null,
    createdAt: new Date(`2026-08-20T10:00:0${id.length}.000Z`),
    ...patch,
  };
}

const sample: OperationalSessionInput[] = [
  session("individual-scheduled"),
  session("individual-completed", {
    date: new Date("2026-09-02T09:00:00.000Z"),
    status: "COMPLETED",
    teacherId: "teacher-b",
    teacher: { name: "Bader" },
  }),
  session("group-completed", {
    date: new Date("2026-09-02T12:00:00.000Z"),
    status: "COMPLETED",
    hours: "2",
    bookingBatchId: "group-occurrence-1",
  }),
  session("group-no-show", {
    date: new Date("2026-09-02T12:00:00.000Z"),
    status: "NO_SHOW",
    hours: 2,
    bookingBatchId: "group-occurrence-1",
  }),
  session("single-member-group", {
    date: new Date("2026-09-03T09:00:00.000Z"),
    status: "CANCELLED",
    teacherId: "teacher-b",
    teacher: { name: "Bader" },
    groupId: "saved-group-1",
  }),
  session("unassigned-home", {
    date: new Date("2026-09-03T14:00:00.000Z"),
    teacherId: null,
    teacher: null,
    hours: 1.5,
    location: "HOME",
  }),
  session("draft", {
    date: new Date("2026-09-04T10:00:00.000Z"),
    status: "DRAFT",
    hours: 99,
  }),
];

describe("session operational analytics", () => {
  it("counts a group lesson once without losing its per-student volume", () => {
    const report = buildSessionOperationalAnalytics(sample);

    expect(report.summary).toEqual({
      sessions: 4,
      studentBookings: 5,
      cancelledSessions: 1,
      cancelledStudentBookings: 1,
      groupSessions: 1,
      individualSessions: 3,
      plannedHours: 5.5,
    });
  });

  it("builds a chronological daily trend and fills requested empty dates", () => {
    const report = buildSessionOperationalAnalytics(sample, {
      from: "2026-09-01",
      to: "2026-09-04",
    });

    expect(report.dailyTrend).toEqual([
      {
        date: "2026-09-01",
        sessions: 1,
        studentBookings: 1,
        cancelledStudentBookings: 0,
        groupSessions: 0,
        individualSessions: 1,
        plannedHours: 1,
        scheduled: 1,
        checkedIn: 0,
        completed: 0,
        noShow: 0,
        cancelled: 0,
      },
      {
        date: "2026-09-02",
        sessions: 2,
        studentBookings: 3,
        cancelledStudentBookings: 0,
        groupSessions: 1,
        individualSessions: 1,
        plannedHours: 3,
        scheduled: 0,
        checkedIn: 0,
        completed: 2,
        noShow: 0,
        cancelled: 0,
      },
      {
        date: "2026-09-03",
        sessions: 1,
        studentBookings: 1,
        cancelledStudentBookings: 1,
        groupSessions: 0,
        individualSessions: 1,
        plannedHours: 1.5,
        scheduled: 1,
        checkedIn: 0,
        completed: 0,
        noShow: 0,
        cancelled: 1,
      },
      {
        date: "2026-09-04",
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
      },
    ]);
  });

  it("shows parent occurrence status and student attendance status separately", () => {
    const report = buildSessionOperationalAnalytics(sample);
    const byStatus = Object.fromEntries(
      report.statusBreakdown.map((row) => [row.status, row]),
    );

    // The mixed completed/no-show class ran, so its parent is completed.
    expect(byStatus.COMPLETED).toMatchObject({
      sessions: 2,
      studentBookings: 2,
      sessionPercentage: 40,
      studentBookingPercentage: 33.3,
    });
    expect(byStatus.NO_SHOW).toMatchObject({
      sessions: 0,
      studentBookings: 1,
      sessionPercentage: 0,
      studentBookingPercentage: 16.7,
    });
    expect(byStatus.CANCELLED).toMatchObject({
      sessions: 1,
      studentBookings: 1,
    });
    expect(report.statusBreakdown.map((row) => row.status)).not.toContain("DRAFT");
  });

  it("resolves an entirely cancelled group occurrence as cancelled", () => {
    const report = buildSessionOperationalAnalytics([
      session("cancelled-a", {
        status: "CANCELLED",
        bookingBatchId: "cancelled-group",
      }),
      session("cancelled-b", {
        status: "CANCELLED",
        bookingBatchId: "cancelled-group",
      }),
    ]);

    expect(report.summary).toMatchObject({
      sessions: 0,
      studentBookings: 0,
      cancelledSessions: 1,
      cancelledStudentBookings: 2,
      groupSessions: 0,
    });
    expect(report.statusBreakdown).toContainEqual({
      status: "CANCELLED",
      sessions: 1,
      studentBookings: 2,
      sessionPercentage: 100,
      studentBookingPercentage: 100,
    });
  });

  it("does not multiply teacher hours by group size", () => {
    const report = buildSessionOperationalAnalytics(sample);

    expect(report.teacherWorkload).toEqual([
      {
        teacherId: "teacher-a",
        teacherName: "Aisha",
        sessions: 2,
        studentBookings: 3,
        plannedHours: 3,
      },
      {
        teacherId: "teacher-b",
        teacherName: "Bader",
        sessions: 1,
        studentBookings: 1,
        plannedHours: 1,
      },
      {
        teacherId: null,
        teacherName: null,
        sessions: 1,
        studentBookings: 1,
        plannedHours: 1.5,
      },
    ]);
  });

  it("breaks down location and group versus individual teaching occurrences", () => {
    const report = buildSessionOperationalAnalytics(sample);

    expect(report.locations).toEqual([
      {
        location: "CENTER",
        sessions: 3,
        studentBookings: 4,
        plannedHours: 4,
      },
      {
        location: "HOME",
        sessions: 1,
        studentBookings: 1,
        plannedHours: 1.5,
      },
    ]);
    expect(report.bookingTypes).toEqual([
      {
        type: "INDIVIDUAL",
        sessions: 3,
        studentBookings: 3,
        plannedHours: 3.5,
        sessionPercentage: 75,
      },
      {
        type: "GROUP",
        sessions: 1,
        studentBookings: 2,
        plannedHours: 2,
        sessionPercentage: 25,
      },
    ]);
  });

  it("returns zero-value day points for an empty requested range", () => {
    const report = buildSessionOperationalAnalytics([], {
      from: "2026-09-10",
      to: "2026-09-11",
    });

    expect(report.summary.sessions).toBe(0);
    expect(report.dailyTrend).toHaveLength(2);
    expect(report.dailyTrend.every((row) => row.sessions === 0)).toBe(true);
    expect(report.bookingTypes.every((row) => row.sessionPercentage === 0)).toBe(true);
  });
});
