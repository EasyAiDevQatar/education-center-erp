import { describe, it, expect } from "vitest";
import { axisPct, axisTicks, dayAxis } from "@/lib/transport/axis";

const H = (h: number, m = 0) => h * 60 + m;

describe("dayAxis", () => {
  it("shows the working window when nothing is booked", () => {
    expect(dayAxis([])).toEqual({ minMin: H(14), maxMin: H(22) });
  });

  it("does not shrink to fit a single trip", () => {
    // The defect this replaced: one 20-minute trip stretched across the board.
    const a = dayAxis([H(16), H(16, 20)]);
    expect(a).toEqual({ minMin: H(14), maxMin: H(22) });
  });

  it("grows outward, to the hour, for work outside the window", () => {
    const a = dayAxis([H(13, 22), H(19)]);
    expect(a.minMin).toBe(H(13));
    expect(a.maxMin).toBe(H(22)); // window floor still honoured
  });

  it("never opens before the centre does or closes after it can", () => {
    const a = dayAxis([H(2), H(25, 30)]);
    expect(a.minMin).toBe(H(7));
    expect(a.maxMin).toBe(H(26));
  });

  it("ignores values that are not numbers", () => {
    expect(dayAxis([NaN, Infinity])).toEqual({ minMin: H(14), maxMin: H(22) });
  });
});

describe("axisPct", () => {
  const axis = { minMin: H(14), maxMin: H(22) };

  it("places the ends at 0 and 100", () => {
    expect(axisPct(axis, H(14))).toBe(0);
    expect(axisPct(axis, H(22))).toBe(100);
  });

  it("places the midpoint at half", () => {
    expect(axisPct(axis, H(18))).toBe(50);
  });

  it("survives a zero-width axis without dividing by zero", () => {
    expect(Number.isFinite(axisPct({ minMin: 600, maxMin: 600 }, 600))).toBe(true);
  });
});

describe("axisTicks", () => {
  it("gives one tick per hour, both ends included", () => {
    const ticks = axisTicks({ minMin: H(14), maxMin: H(17) });
    expect(ticks).toEqual([H(14), H(15), H(16), H(17)]);
  });
});
