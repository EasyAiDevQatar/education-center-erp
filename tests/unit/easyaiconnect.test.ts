import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePhone, normalizePhones } from "@/lib/integrations/phone";
import { encryptSecret, decryptSecret, isEncrypted } from "@/lib/integrations/secret-crypto";

/* ------------------------------------------------------------ white label --- */

const SKIP = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.isFile() && /\.(ts|tsx|json|prisma|md)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("the delivery vendor is named in exactly one place", () => {
  it("appears only in the upstream constant", () => {
    const root = process.cwd();
    const hits: string[] = [];
    for (const file of sourceFiles(root)) {
      const rel = path.relative(root, file).replace(/\\/g, "/");
      // This test necessarily contains the word it is looking for.
      if (rel === "tests/unit/easyaiconnect.test.ts") continue;
      const src = readFileSync(file, "utf8");
      if (/anychat/i.test(src)) hits.push(rel);
    }
    // If this fails, the product name leaked. Put the string back behind
    // UPSTREAM in lib/integrations/easyaiconnect.ts and map the error to a code.
    expect(hits).toEqual(["lib/integrations/easyaiconnect.ts"]);
  }, 15_000);

  it("keeps it out of anything a user can read", () => {
    const root = process.cwd();
    for (const messages of ["messages/ar.json", "messages/en.json"]) {
      expect(readFileSync(path.join(root, messages), "utf8")).not.toMatch(/anychat/i);
    }
  });
});

/* ---------------------------------------------------------------- phones --- */

describe("phone normalisation", () => {
  it("accepts what people actually type", () => {
    expect(normalizePhone("+974 5555 1234")).toBe("+97455551234");
    expect(normalizePhone("+974-5555-1234")).toBe("+97455551234");
    expect(normalizePhone("00974 5555 1234")).toBe("+97455551234");
    // A bare Qatar local number, with and without the trunk zero.
    expect(normalizePhone("55551234")).toBe("+97455551234");
    expect(normalizePhone("055551234")).toBe("+97455551234");
  });

  it("returns null rather than throwing on what cannot be dialled", () => {
    // One unreachable guardian must not abort the run for everyone else.
    for (const bad of ["", "   ", "abc", "12", null, undefined]) {
      expect(normalizePhone(bad)).toBeNull();
    }
  });

  it("de-duplicates numbers that differ only in formatting", () => {
    expect(normalizePhones(["+974 5555 1234", "97455551234", "55551234", "bad"])).toEqual([
      "+97455551234",
    ]);
  });
});

/* --------------------------------------------------------------- secrets --- */

describe("credential encryption", () => {
  it("round-trips a key", () => {
    process.env.CREDENTIAL_KEY ||= "test-key-for-vitest";
    const stored = encryptSecret("sk_live_abc123");
    expect(stored).not.toContain("sk_live_abc123");
    expect(isEncrypted(stored)).toBe(true);
    expect(decryptSecret(stored)).toBe("sk_live_abc123");
  });

  it("never produces the same ciphertext twice", () => {
    process.env.CREDENTIAL_KEY ||= "test-key-for-vitest";
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("reads a legacy clear-text value unchanged", () => {
    // This is the migration: rows written before encryption existed keep
    // working, and are re-encrypted the next time settings are saved.
    expect(isEncrypted("plain-old-key")).toBe(false);
    expect(decryptSecret("plain-old-key")).toBe("plain-old-key");
  });

  it("returns empty rather than throwing when a value cannot be read", () => {
    // A wrong key must not take down every page that reads settings.
    expect(decryptSecret("v1:aaaa:bbbb:cccc")).toBe("");
  });
});
