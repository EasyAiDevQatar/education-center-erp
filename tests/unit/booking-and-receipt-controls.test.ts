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

  it("uses the saved print default across printable documents", () => {
    const button = read("components/print-button.tsx");
    const settings = read("app/[locale]/(app)/settings/center-profile-form.tsx");
    expect(button).toContain('formats = ["A4", "A5", "POS80"]');
    expect(button).toContain("data-print-size-selectable");
    expect(settings).toContain('name="receiptSize"');
    expect(settings).toContain('t("receiptSizeHint")');
  });

  it("renders document receipts at statement width while retaining POS", () => {
    const page = read("app/[locale]/receipt/[id]/page.tsx");
    expect(page).toContain('"mx-auto max-w-4xl p-6"');
    expect(page).toContain('format === "A5"');
    expect(page).toContain('const isPos = format === "POS80"');
  });
});

describe("student special pricing", () => {
  it("stores an optional student rate and enforces it server-side", () => {
    const schema = read("prisma/schema.prisma");
    const pricing = read("lib/pricing.ts");
    const actions = read("app/[locale]/(app)/sessions/actions.ts");
    expect(schema).toContain("specialPricePerHour Decimal?");
    expect(pricing).toContain("resolveStudentPricePerHour");
    expect(pricing).toContain("student?.specialPricePerHour != null");
    expect(actions).toContain("resolveStudentPricePerHour(");
  });

  it("shows the override and linked teachers on the student profile", () => {
    const form = read("app/[locale]/(app)/students/students-client.tsx");
    const profile = read("app/[locale]/(app)/students/[id]/page.tsx");
    expect(form).toContain('name="specialPricePerHour"');
    expect(form).toContain('name="teacherIds"');
    expect(profile).toContain('t("assignedTeachers")');
  });
});

describe("compact teacher statements", () => {
  it("omits empty salary/payout furniture for commission-only teachers", () => {
    const page = read("app/[locale]/statement/teacher/[id]/page.tsx");
    expect(page).toContain("const showPayouts = salary.total > 0 || payouts.length > 0");
    expect(page).toContain("{showPayouts && (");
    expect(page).toContain("p-1.5 tabular-nums");
  });
});
