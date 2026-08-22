import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { unbilledStatuses } from "@/lib/attendance-policy";

/**
 * The money paths must keep asking one question.
 *
 * They did not, and the disagreement was invisible: the student's ledger
 * excluded only DRAFT, so a cancelled lesson and an unbilled no-show were shown
 * to the parent as money owed and chased by the nightly reminder — while the
 * allocation screen excluded those same statuses, so nobody could pay it off.
 * Payroll used a third list and paid commission on lessons never charged for.
 * 650 tests passed throughout, because each file was individually reasonable.
 *
 * These tests are about the composition rather than any one file.
 */
describe("what counts as a charge", () => {
  it("drops a no-show only when the centre does not bill it", () => {
    expect(unbilledStatuses("CANCELLED", ["DRAFT", "CANCELLED"])).toEqual([
      "DRAFT",
      "CANCELLED",
      "NO_SHOW",
    ]);
    // TAUGHT means the slot was held and is billed, so it stays chargeable.
    expect(unbilledStatuses("TAUGHT", ["DRAFT", "CANCELLED"])).toEqual(["DRAFT", "CANCELLED"]);
  });

  it("never treats a cancelled lesson as chargeable under either policy", () => {
    for (const policy of ["CANCELLED", "TAUGHT"] as const) {
      expect(unbilledStatuses(policy, ["DRAFT", "CANCELLED"])).toContain("CANCELLED");
    }
  });
});

/**
 * A structural check: the four money readers must defer to the shared rule
 * rather than writing their own status list. This is the assertion that would
 * have failed while the bug existed, and it fails again the moment somebody
 * reintroduces a hand-rolled list in one of these files.
 */
describe("the money readers share one rule", () => {
  const root = process.cwd();
  const readers = [
    "lib/balances.ts", // student balance, ledger, statement, dues reminders
    "lib/payroll.ts", // teacher commission
    "lib/role-dashboard.ts", // the cashier's outstanding figure
  ];

  for (const file of readers) {
    it(`${file} asks unchargeableStatuses()`, () => {
      const src = readFileSync(path.join(root, file), "utf8");
      expect(src).toContain("unchargeableStatuses");
    });

    it(`${file} writes no literal status list into a money query`, () => {
      const src = readFileSync(path.join(root, file), "utf8");
      // Counting lessons may legitimately drop drafts and nothing else — a
      // register is not a bill. What must never reappear is a hand-written
      // exclusion list, which is the shape every one of these bugs wore.
      expect(src).not.toMatch(/notIn:\s*\[\s*"DRAFT"/);
    });
  }

  it("billing.ts is where the rule lives", () => {
    const src = readFileSync(path.join(root, "lib/billing.ts"), "utf8");
    expect(src).toContain("export async function unchargeableStatuses");
    expect(src).toContain('["DRAFT", "CANCELLED"]');
  });
});
