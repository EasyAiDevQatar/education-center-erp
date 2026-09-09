import { describe, expect, it } from "vitest";

import { referenceCode } from "@/lib/reference-code";

describe("referenceCode", () => {
  it("formats compact, human-readable codes for each record type", () => {
    expect(referenceCode("student", 1)).toBe("S-1001");
    expect(referenceCode("teacher", 25)).toBe("T-1025");
    expect(referenceCode("session", 999)).toBe("SE-1999");
  });

  it("keeps entity prefixes distinct", () => {
    expect(new Set([
      referenceCode("student", 7),
      referenceCode("teacher", 7),
      referenceCode("session", 7),
    ]).size).toBe(3);
  });
});
