import { describe, expect, it } from "vitest";
import {
  groupOccurrenceKeys,
  hasExplicitGroupIdentity,
  sessionOccurrenceKey,
  type GroupableSession,
} from "@/lib/session-grouping";
import { readSessionFilters } from "@/lib/session-query";

const at = new Date("2026-09-23T12:50:00.000Z");
const created = new Date("2026-08-31T10:01:33.537Z");

function row(patch: Partial<GroupableSession> = {}): GroupableSession {
  return {
    bookingBatchId: null,
    groupId: null,
    date: at,
    teacherId: "teacher-1",
    hours: 1,
    location: "CENTER",
    createdAt: created,
    ...patch,
  };
}

describe("session occurrence grouping", () => {
  it("uses the booking batch as the canonical identity", () => {
    expect(sessionOccurrenceKey(row({ bookingBatchId: "batch-1" }))).toBe("batch:batch-1");
  });

  it("keeps legacy saved groups separate by their exact schedule", () => {
    const first = sessionOccurrenceKey(row({ groupId: "group-1" }));
    const later = sessionOccurrenceKey(
      row({ groupId: "group-1", date: new Date("2026-09-30T12:50:00.000Z") }),
    );
    expect(first).not.toBe(later);
  });

  it("recognizes old ad-hoc rows only when their creation and schedule match", () => {
    const rows = [row(), row()];
    expect(groupOccurrenceKeys(rows)).toEqual(new Set([sessionOccurrenceKey(rows[0])]));
    expect(
      groupOccurrenceKeys([
        row(),
        row({ createdAt: new Date("2026-08-31T10:01:33.538Z") }),
      ]),
    ).toEqual(new Set());
  });

  it("retains an explicit group identity when one active member remains", () => {
    const single = row({ bookingBatchId: "batch-1" });
    expect(hasExplicitGroupIdentity(single)).toBe(true);
    expect(groupOccurrenceKeys([single])).toEqual(new Set(["batch:batch-1"]));
  });

  it("does not classify one ordinary lesson as a group", () => {
    expect(groupOccurrenceKeys([row()])).toEqual(new Set());
  });
});

describe("session booking-type filter", () => {
  it("accepts the two supported URL values", () => {
    expect(readSessionFilters({ bookingType: "group" }).bookingType).toBe("group");
    expect(readSessionFilters({ bookingType: "individual" }).bookingType).toBe("individual");
  });

  it("drops unsupported URL values", () => {
    expect(readSessionFilters({ bookingType: "anything" }).bookingType).toBe("");
  });
});
