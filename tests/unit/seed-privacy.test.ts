import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The seeder must not be able to telephone a real person.
 *
 * It used to give demo people numbers like 55551000 and 77771024 — not
 * placeholders, but live Qatari mobile ranges. That was harmless while nothing
 * could send, and stopped being harmless the moment the messaging module was
 * connected: booking messages reached +97477771001 and +97477771024, whoever
 * they belong to.
 *
 * This is a source-shape test rather than a behavioural one because the failure
 * is a future edit — somebody adding a person to the seeder next year and
 * giving them a plausible-looking number for the demo screenshots.
 */
describe("the seeder cannot telephone a stranger", () => {
  const src = readFileSync(
    path.join(process.cwd(), "app/[locale]/(app)/settings/data-actions.ts"),
    "utf8",
  );

  it("assigns no digits to a phone field", () => {
    const assigned = [...src.matchAll(/phone:\s*([^,\n]+)/g)].map((m) => m[1].trim());
    // Guards against the regex silently matching nothing and passing vacuously.
    expect(assigned.length).toBeGreaterThanOrEqual(6);
    for (const value of assigned) {
      expect(value, `a seeded phone is built from digits: ${value}`).not.toMatch(/[0-9]/);
    }
  });

  it("keeps the shared constant blank", () => {
    // Blank, not a fake number: a fake number is still a string, and a string
    // in a phone field is something that eventually gets dialled.
    expect(src).toMatch(/const SEEDED_PHONE = null;/);
  });

  it("routes every seeded person through that one constant", () => {
    const literal = [...src.matchAll(/phone:\s*`[^`]*`/g)];
    expect(literal, "a template literal is being used as a phone number").toHaveLength(0);
  });
});
