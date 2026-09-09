import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("booking controls", () => {
  it("keeps calendar creation opt-in and enforced by the calendar action", () => {
    const page = read("app/[locale]/(app)/calendar/page.tsx");
    const action = read("app/[locale]/(app)/calendar/actions.ts");
    expect(page).toContain('settingsMap.calendarBookingEnabled === "1"');
    expect(action).toContain('setting?.value !== "1"');
    expect(action).toContain('error: "calendarBookingDisabled"');
  });

  it("posts the planner's editable price instead of silently re-resolving it", () => {
    const action = read("app/[locale]/(app)/planner/actions.ts");
    const client = read("app/[locale]/(app)/planner/planner-client.tsx");
    expect(action).toContain("const pricePerHour = d.pricePerHour;");
    expect(client).toContain("pricePerHour,");
    expect(client).toContain('id="p-price"');
  });
});

describe("receipt formats and teacher allocation", () => {
  it("offers POS, A4 and A5 for each receipt", () => {
    const controls = read("app/[locale]/receipt/[id]/receipt-print-controls.tsx");
    for (const format of ["POS80", "A4", "A5"]) {
      expect(controls).toContain(`value="${format}"`);
    }
  });

  it("credits payroll from per-session teacher allocations", () => {
    const payroll = read("lib/payroll.ts");
    expect(payroll).toContain("db.paymentAllocation.findMany");
    expect(payroll).toContain('session: { teacherId }');
    expect(payroll).toContain('allocations: { none: {} }');
  });
});
