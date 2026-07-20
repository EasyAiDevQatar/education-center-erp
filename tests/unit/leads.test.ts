import { describe, it, expect } from "vitest";
import { followUpState, funnelCounts } from "@/lib/leads";

const TODAY = "2026-07-20";

describe("followUpState", () => {
  it("returns none when no follow-up date is set", () => {
    expect(followUpState(null, "NEW", TODAY)).toBe("none");
    expect(followUpState(undefined, "NEW", TODAY)).toBe("none");
  });

  it("flags a past date as overdue", () => {
    expect(followUpState("2026-07-19", "CONTACTED", TODAY)).toBe("overdue");
  });

  it("flags today as due today", () => {
    expect(followUpState(TODAY, "NEW", TODAY)).toBe("dueToday");
  });

  it("treats a future date as upcoming", () => {
    expect(followUpState("2026-07-25", "TRIAL", TODAY)).toBe("upcoming");
  });

  it("stops nagging once the lead is closed", () => {
    // An overdue date on an enrolled/lost lead is history, not a task.
    expect(followUpState("2026-01-01", "ENROLLED", TODAY)).toBe("none");
    expect(followUpState("2026-01-01", "LOST", TODAY)).toBe("none");
  });
});

describe("funnelCounts", () => {
  const leads = [
    { status: "NEW" },
    { status: "NEW" },
    { status: "CONTACTED" },
    { status: "TRIAL" },
    { status: "ENROLLED" },
    { status: "ENROLLED" },
    { status: "ENROLLED" },
    { status: "LOST" },
  ];

  it("counts each stage", () => {
    const f = funnelCounts(leads);
    expect(f).toMatchObject({ new: 2, contacted: 1, trial: 1, enrolled: 3, lost: 1, total: 8 });
  });

  it("rates conversion against decided leads only", () => {
    // 3 enrolled of 4 decided = 75%; the 4 still in play don't count against it.
    expect(funnelCounts(leads).conversionRate).toBe(75);
  });

  it("reports zero conversion when nothing has been decided", () => {
    expect(funnelCounts([{ status: "NEW" }, { status: "TRIAL" }]).conversionRate).toBe(0);
  });

  it("handles an empty pipeline", () => {
    expect(funnelCounts([])).toMatchObject({ total: 0, conversionRate: 0 });
  });
});
