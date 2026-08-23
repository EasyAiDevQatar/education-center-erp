import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("three-tab attendance workspace", () => {
  it("validates URL state and defaults to attendance list view", () => {
    const page = read("app/[locale]/(app)/checkin/page.tsx");
    expect(page).toContain('["attendance", "needs-teacher", "review"]');
    expect(page).toContain('["list", "cards"]');
    expect(page).toContain(': "attendance"');
    expect(page).toContain(': "list"');
  });

  it("keeps both queues global and does not silently cap the backlog", () => {
    const page = read("app/[locale]/(app)/checkin/page.tsx");
    expect(page).toContain('where: { autoCompleted: true }');
    expect(page).toContain('where: { needsTeacher: true }');
    expect(page).not.toMatch(/where: \{ autoCompleted: true \}[\s\S]{0,180}take:/);
    expect(page).not.toMatch(/where: \{ needsTeacher: true \}[\s\S]{0,180}take:/);
  });

  it("uses one lifecycle action set in list and card views", () => {
    const board = read("app/[locale]/(app)/checkin/roster-board.tsx");
    expect(board).toContain("function SessionActions");
    expect(board).toContain("manualCheckInSession(locale, item.id)");
    expect(board).toContain("checkOutSession(locale, item.id)");
    expect(board).toContain("markNoShow(locale, item.id)");
    expect(board).toContain("undoCheckin(locale, item.id)");
  });

  it("shows separate actual and billable durations", () => {
    const page = read("app/[locale]/(app)/checkin/page.tsx");
    const board = read("app/[locale]/(app)/checkin/roster-board.tsx");
    expect(page).toContain("elapsedMinutes(s.studentCheckInAt, s.studentCheckOutAt)");
    expect(board).toContain('t("actualColumn")');
    expect(board).toContain('t("billableColumn")');
    expect(board).toContain("formatDurationClock(item.actualMinutes)");
    expect(board).toContain("formatDurationClock(item.billableMinutes)");
  });

  it("validates teacher assignment against work on the walk-in date", () => {
    const action = read("app/[locale]/(app)/settings/attendance-actions.ts");
    expect(action).toContain("target.date");
    expect(action).toContain('status: { in: ["CHECKED_IN", "COMPLETED"] }');
    expect(action).toContain('return { error: "notEligibleTeacher" }');
  });
});
