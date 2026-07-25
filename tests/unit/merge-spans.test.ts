import { describe, it, expect } from "vitest";
import { mergeSpans } from "@/lib/transport/feasibility";

const s = (startMin: number, endMin: number) => ({ startMin, endMin });

describe("mergeSpans — the occupied-at-the-centre band", () => {
  it("collapses back-to-back lessons into one band", () => {
    // The whole point: four consecutive centre lessons must read as ONE band,
    // or the muted indicator is just the wall of blocks it replaced.
    expect(
      mergeSpans([s(900, 960), s(960, 1020), s(1020, 1080), s(1080, 1170)]),
    ).toEqual([s(900, 1170)]);
  });

  it("merges overlapping spans", () => {
    expect(mergeSpans([s(840, 930), s(900, 1020)])).toEqual([s(840, 1020)]);
  });

  it("keeps genuinely separate spans apart", () => {
    expect(mergeSpans([s(840, 900), s(1020, 1080)])).toEqual([
      s(840, 900),
      s(1020, 1080),
    ]);
  });

  it("does not care what order it is given", () => {
    expect(mergeSpans([s(1020, 1080), s(840, 900), s(900, 960)])).toEqual([
      s(840, 960),
      s(1020, 1080),
    ]);
  });

  it("swallows a span fully inside another", () => {
    expect(mergeSpans([s(840, 1080), s(900, 960)])).toEqual([s(840, 1080)]);
  });

  it("never mutates the caller's objects", () => {
    // The band is derived from the very session objects the board renders. If
    // merging wrote through to them, hiding centre lessons would silently
    // rewrite the lesson times being displayed.
    const input = [s(900, 960), s(960, 1020)];
    const snapshot = input.map((x) => ({ ...x }));
    mergeSpans(input);
    expect(input).toEqual(snapshot);
  });

  it("drops zero-length and inverted spans", () => {
    expect(mergeSpans([s(900, 900), s(1000, 950)])).toEqual([]);
  });

  it("handles an empty day", () => {
    expect(mergeSpans([])).toEqual([]);
  });
});
