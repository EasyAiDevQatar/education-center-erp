import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every screen that says a lesson happened must say it the same way.
 *
 * The bug this guards against has now appeared three times in the same
 * codebase: a second screen does most of what the first one does, forgets the
 * last step, and nobody notices because each file reads perfectly well on its
 * own. Attendance notifications were missing from three of four marking
 * paths; then the planner turned out to confirm a draft with its own copy of
 * the transaction and no notification at all, which is why a home visit
 * planned there reached the family as silence.
 *
 * Source-shape tests, because the failure is always a future edit.
 */

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("one way to mark attendance", () => {
  it("lib/attendance.ts owns it and notifies", () => {
    const src = read("lib/attendance.ts");
    expect(src).toContain("export async function applyMark");
    expect(src).toContain('notifySession("CHECKED_IN"');
    expect(src).toContain('notifySession("SESSION_NO_SHOW"');
  });

  const callers = [
    "app/[locale]/(app)/checkin/actions.ts",
    "app/[locale]/(app)/planner/actions.ts",
  ];

  for (const file of callers) {
    it(`${file} defers to it`, () => {
      const src = read(file);
      expect(src).toContain('from "@/lib/attendance"');
      // Nobody keeps a private copy.
      expect(src).not.toContain("async function applyMark");
    });

    it(`${file} does not move a session to COMPLETED behind its back`, () => {
      const src = read(file);
      // The shape the planner wore: its own update, its own package drawdown,
      // and silence. Marking must go through applyMark so the family is told.
      expect(src).not.toMatch(/session\.update\(\{\s*where:[^}]*\},\s*data:\s*\{\s*status:\s*"COMPLETED"\s*\}/);
    });
  }
});
