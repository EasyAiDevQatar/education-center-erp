import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The gate is only as good as its weakest caller.
 *
 * A password checked by the page and not by the actions is not a password:
 * a server action is reachable by POST without ever loading the page that
 * drew the form. These tests assert the shape rather than the behaviour,
 * because the failure they guard against is somebody adding a fifth action
 * next year and forgetting the two lines at the top.
 */

const root = process.cwd();
const ACTIONS = "app/[locale]/(app)/settings/integrations-actions.ts";

function source(rel: string) {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("every integrations action is behind the module gate", () => {
  const src = source(ACTIONS);

  it("the shared guard consults the gate, not only the role", () => {
    expect(src).toContain("requireGate");
    expect(src).toMatch(/s\.role !== "ADMIN"/);
  });

  it("no exported action skips it", () => {
    const exported = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    // If this drops to nothing the regex broke, and the test below would pass
    // vacuously — which is the failure mode of every "assert each" test.
    expect(exported.length).toBeGreaterThanOrEqual(4);

    for (const name of exported) {
      const start = src.indexOf(`export async function ${name}`);
      const next = src.indexOf("\nexport async function", start + 1);
      const body = src.slice(start, next === -1 ? undefined : next);
      // Every one of them opens by calling guard() and returning its refusal.
      expect(body, `${name} does not call guard()`).toContain("await guard()");
    }
  });

  it("keeps the secret out of the audit trail", () => {
    // The audit records that a credential changed, never the credential.
    expect(src).toMatch(/apiKey: apiKey \? "\*\*\*" : null/);
    expect(src).toContain('webhookSecret: "rotated"');
  });
});

describe("the gate itself", () => {
  const src = source("lib/integrations/gate.ts");

  it("ties the unlock cookie to the user who opened it", () => {
    // Otherwise signing out and in as somebody else inherits an open gate.
    expect(src).toContain("userId === session.userId");
  });

  it("expires in minutes, not days", () => {
    // Read as a product of literals rather than eval'd — the point is the
    // magnitude, and a test does not need an interpreter to check it.
    const m = src.match(/const MAX_AGE = ([^;]+);/);
    expect(m).toBeTruthy();
    const seconds = m![1]
      .split('*')
      .map((part) => Number(part.trim()))
      .reduce((a, b) => a * b, 1);
    expect(seconds).toBeLessThanOrEqual(60 * 60);
  });

  it("rate-limits wrong guesses", () => {
    expect(src).toContain("tooManyAttempts");
  });

  it("never stores the password in the clear", () => {
    expect(src).toContain("hashPassword");
    expect(src).toContain("verifyPassword");
  });
});
