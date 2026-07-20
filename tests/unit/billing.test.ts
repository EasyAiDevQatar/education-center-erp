import { describe, it, expect } from "vitest";
import { paymentStatusFor, packageStatusFor, autoAllocate } from "@/lib/billing-rules";

describe("paymentStatusFor", () => {
  it("classifies unpaid, partial and paid", () => {
    expect(paymentStatusFor(175, 0)).toBe("UNPAID");
    expect(paymentStatusFor(175, 100)).toBe("PARTIAL");
    expect(paymentStatusFor(175, 175)).toBe("PAID");
  });
  it("treats over-payment as paid", () => {
    expect(paymentStatusFor(175, 200)).toBe("PAID");
  });
  it("tolerates float drift", () => {
    expect(paymentStatusFor(175, 174.999)).toBe("PAID");
  });
});

describe("packageStatusFor", () => {
  const future = new Date("2030-01-01");
  const past = new Date("2020-01-01");
  it("stays active while hours remain", () => {
    expect(packageStatusFor(10, 4, null)).toBe("ACTIVE");
    expect(packageStatusFor(10, 4, future)).toBe("ACTIVE");
  });
  it("completes when hours are exhausted", () => {
    expect(packageStatusFor(10, 10, future)).toBe("COMPLETED");
    expect(packageStatusFor(10, 11, null)).toBe("COMPLETED");
  });
  it("expires only when hours remain but the date passed", () => {
    expect(packageStatusFor(10, 4, past)).toBe("EXPIRED");
    // exhausted takes precedence over expiry
    expect(packageStatusFor(10, 10, past)).toBe("COMPLETED");
  });
});

describe("autoAllocate", () => {
  const sessions = [
    { id: "a", outstanding: 175 },
    { id: "b", outstanding: 175 },
    { id: "c", outstanding: 100 },
  ];

  it("fills sessions oldest-first", () => {
    expect(autoAllocate(200, sessions)).toEqual([
      { sessionId: "a", amount: 175 },
      { sessionId: "b", amount: 25 },
    ]);
  });

  it("never allocates more than the payment", () => {
    const out = autoAllocate(50, sessions);
    expect(out).toEqual([{ sessionId: "a", amount: 50 }]);
    expect(out.reduce((s, x) => s + x.amount, 0)).toBe(50);
  });

  it("never allocates more than the outstanding total", () => {
    const out = autoAllocate(1000, sessions);
    expect(out.reduce((s, x) => s + x.amount, 0)).toBe(450); // 175+175+100
  });

  it("returns nothing for a zero payment", () => {
    expect(autoAllocate(0, sessions)).toEqual([]);
  });
});
