import { describe, expect, it } from "vitest";
import { resolveReportDateStrings } from "@/lib/report-range";

describe("report date ranges", () => {
  it("defaults daily sessions to 30 inclusive Qatar calendar days", () => {
    expect(resolveReportDateStrings({
      report: "daily-sessions",
      today: "2026-09-09",
    })).toEqual({ from: "2026-08-11", to: "2026-09-09" });
  });

  it("completes one-sided daily ranges", () => {
    expect(resolveReportDateStrings({
      report: "daily-sessions",
      to: "2026-03-01",
      today: "2026-09-09",
    })).toEqual({ from: "2026-01-31", to: "2026-03-01" });
    expect(resolveReportDateStrings({
      report: "daily-sessions",
      from: "2026-09-01",
      today: "2026-09-09",
    })).toEqual({ from: "2026-09-01", to: "2026-09-09" });
  });

  it("uses the term exactly and normalizes reversed or invalid URL dates", () => {
    expect(resolveReportDateStrings({
      report: "attendance",
      from: "not-a-date",
      to: "2026-09-31",
    })).toEqual({ from: "", to: "" });
    expect(resolveReportDateStrings({
      report: "attendance",
      from: "2026-09-09",
      to: "2026-09-01",
    })).toEqual({ from: "2026-09-01", to: "2026-09-09" });
    expect(resolveReportDateStrings({
      report: "daily-sessions",
      from: "2020-01-01",
      to: "2020-01-02",
      termFrom: "2026-01-01",
      termTo: "2026-06-30",
    })).toEqual({ from: "2026-01-01", to: "2026-06-30" });
  });
});
