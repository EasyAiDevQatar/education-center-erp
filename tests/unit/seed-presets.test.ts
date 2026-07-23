import { describe, expect, it } from "vitest";
import { SEED_PRESETS, SEED_SPEC, presetCounts } from "@/lib/data-zone";

describe("SEED_SPEC", () => {
  it("has unique keys", () => {
    const keys = SEED_SPEC.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every default sits inside its own max", () => {
    // The bug this guards: a default (or preset) above `max` makes the seed
    // action reject the whole form with a single opaque error.
    for (const s of SEED_SPEC) {
      expect(s.default, s.key).toBeLessThanOrEqual(s.max);
      expect(s.default, s.key).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("presetCounts", () => {
  it.each(SEED_PRESETS.map((p) => p.key))("%s never exceeds any field max", (preset) => {
    const counts = presetCounts(preset);
    for (const s of SEED_SPEC) {
      expect(counts[s.key], `${preset}/${s.key}`).toBeLessThanOrEqual(s.max);
      expect(counts[s.key], `${preset}/${s.key}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("covers every SEED_SPEC key", () => {
    const counts = presetCounts("medium");
    expect(Object.keys(counts).sort()).toEqual(SEED_SPEC.map((s) => s.key).sort());
  });

  it("small is the plain defaults", () => {
    const counts = presetCounts("small");
    for (const s of SEED_SPEC) expect(counts[s.key], s.key).toBe(s.default);
  });

  it("larger presets never shrink a count", () => {
    const small = presetCounts("small");
    const medium = presetCounts("medium");
    const large = presetCounts("large");
    for (const s of SEED_SPEC) {
      expect(medium[s.key], s.key).toBeGreaterThanOrEqual(small[s.key]);
      expect(large[s.key], s.key).toBeGreaterThanOrEqual(medium[s.key]);
    }
  });

  it("actually scales the headline counts", () => {
    expect(presetCounts("large").students).toBeGreaterThan(presetCounts("small").students);
  });

  it("an unknown preset falls back to defaults rather than zeroing the form", () => {
    // @ts-expect-error deliberately invalid key
    const counts = presetCounts("enormous");
    expect(counts.students).toBe(SEED_SPEC.find((s) => s.key === "students")!.default);
  });
});
