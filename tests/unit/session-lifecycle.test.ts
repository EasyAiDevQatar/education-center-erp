import { describe, expect, it } from "vitest";
import {
  MIN_CHECKOUT_MS,
  canApplyAttendanceMark,
  canCancelSession,
  canCheckIn,
  canCheckOut,
  canUndoAttendance,
} from "@/lib/session-lifecycle";
import {
  centerClockTime,
  centerNowTime,
  centerToday,
  centerWallClockNow,
} from "@/lib/session-time";

describe("session attendance lifecycle", () => {
  it("checks in only scheduled sessions", () => {
    expect(canCheckIn("SCHEDULED")).toBe(true);
    for (const status of ["DRAFT", "CHECKED_IN", "COMPLETED", "NO_SHOW", "CANCELLED"]) {
      expect(canCheckIn(status)).toBe(false);
    }
  });

  it("requires a real check-in and blocks an immediate double scan", () => {
    const checkedIn = new Date("2026-08-23T10:00:00.000Z");
    expect(canCheckOut("CHECKED_IN", checkedIn, new Date(checkedIn.getTime() + MIN_CHECKOUT_MS - 1))).toBe(false);
    expect(canCheckOut("CHECKED_IN", checkedIn, new Date(checkedIn.getTime() + MIN_CHECKOUT_MS))).toBe(true);
    expect(canCheckOut("SCHEDULED", checkedIn, new Date(checkedIn.getTime() + MIN_CHECKOUT_MS))).toBe(false);
    expect(canCheckOut("CHECKED_IN", null, new Date(checkedIn.getTime() + MIN_CHECKOUT_MS))).toBe(false);
  });

  it("cancels only before teaching starts", () => {
    expect(canCancelSession("DRAFT")).toBe(true);
    expect(canCancelSession("SCHEDULED")).toBe(true);
    for (const status of ["CHECKED_IN", "COMPLETED", "NO_SHOW", "CANCELLED"]) {
      expect(canCancelSession(status)).toBe(false);
    }
  });

  it("undoes only recorded attendance and never revives cancelled sessions", () => {
    for (const status of ["CHECKED_IN", "COMPLETED", "NO_SHOW"]) {
      expect(canUndoAttendance(status)).toBe(true);
    }
    for (const status of ["DRAFT", "SCHEDULED", "CANCELLED"]) {
      expect(canUndoAttendance(status)).toBe(false);
    }
  });

  it("keeps cancelled terminal while allowing explicit attendance corrections", () => {
    expect(canApplyAttendanceMark("CANCELLED", "COMPLETED")).toBe(false);
    expect(canApplyAttendanceMark("CANCELLED", "SCHEDULED")).toBe(false);
    expect(canApplyAttendanceMark("COMPLETED", "SCHEDULED")).toBe(true);
    expect(canApplyAttendanceMark("NO_SHOW", "SCHEDULED")).toBe(true);
    expect(canApplyAttendanceMark("SCHEDULED", "COMPLETED")).toBe(true);
    expect(canApplyAttendanceMark("SCHEDULED", "NO_SHOW")).toBe(true);
  });
});

describe("centre wall clock", () => {
  it("uses Qatar's date and time around UTC midnight", () => {
    const instant = new Date("2026-08-22T22:30:00.000Z");
    expect(centerToday(instant)).toBe("2026-08-23");
    expect(centerNowTime(instant)).toBe("01:30");
    expect(centerWallClockNow(instant).toISOString()).toBe("2026-08-23T01:30:00.000Z");
    expect(centerClockTime(instant)).toBe("01:30");
  });
});
