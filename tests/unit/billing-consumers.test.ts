import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("every dues reader uses the shared chargeability rule", () => {
  const readers = [
    "lib/reports.ts",
    "lib/report-queries.ts",
    "lib/ai/tools.ts",
    "app/[locale]/(app)/payments/balance-actions.ts",
    "app/[locale]/(app)/payments/allocation-actions.ts",
    "app/[locale]/(app)/payments/actions.ts",
    "app/api/import/[table]/route.ts",
    "app/[locale]/statement/teacher/[id]/page.tsx",
    "app/[locale]/payslip/[id]/page.tsx",
  ];

  for (const file of readers) {
    it(`${file} defers to unchargeableStatuses()`, () => {
      expect(read(file)).toContain("unchargeableStatuses");
    });
  }

  it("validates submitted allocations against chargeable, non-package sessions", () => {
    const src = read("app/[locale]/(app)/payments/actions.ts");
    expect(src).toContain("packageId: null");
    expect(src).toContain("status: { notIn: unchargeable }");
  });

  it("never offers quick pay on a cancelled row", () => {
    const src = read("app/[locale]/(app)/sessions/sessions-client.tsx");
    expect(src).toContain('s.paymentStatus !== "PAID" && s.chargeable');
  });
});

describe("automatic attendance waits for a person", () => {
  it("the cron flags stale sessions without completing or billing them", () => {
    const src = read("app/api/cron/route.ts");
    expect(src).toContain('status: "SCHEDULED", autoCompleted: false');
    expect(src).toContain('data: { autoCompleted: true }');
    expect(src).not.toContain('data: { status: "COMPLETED", autoCompleted: true }');
  });

  it("a walk-in starts checked in rather than completed", () => {
    const src = read("app/[locale]/(app)/checkin/actions.ts");
    const walkIn = src.slice(src.indexOf("const created = await db.session.create"));
    expect(walkIn).toContain('status: "CHECKED_IN"');
    expect(walkIn.indexOf('status: "CHECKED_IN"')).toBeLessThan(walkIn.indexOf("/* ---- one or more booked ---- */"));
  });
});
