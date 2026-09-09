import { describe, expect, it } from "vitest";
import {
  buildPaymentCashFlowReport,
  type PaymentCashFlowInput,
} from "@/lib/payment-cash-flow";

function payment(
  patch: Partial<PaymentCashFlowInput> = {},
): PaymentCashFlowInput {
  return {
    date: new Date("2026-01-10T00:00:00.000Z"),
    method: "CASH",
    amount: 100,
    status: "COMPLETED",
    refundAmount: null,
    voidedAt: null,
    ...patch,
  };
}

describe("payment cash-flow reporting", () => {
  it("reports gross, refunds, net and method share for lifetime data", () => {
    const report = buildPaymentCashFlowReport([
      payment(),
      payment({
        date: "2026-01-20T00:00:00.000Z",
        method: "POS",
        amount: "200",
        status: "REFUNDED",
        refundAmount: "50",
        voidedAt: "2026-02-05T12:00:00.000Z",
      }),
      payment({
        date: new Date("2025-12-20T00:00:00.000Z"),
        amount: 80,
        status: "REFUNDED",
        refundAmount: 80,
        // 22:30 UTC is 01:30 on 1 March in Qatar.
        voidedAt: new Date("2026-02-28T22:30:00.000Z"),
      }),
      payment({ method: "TRANSFER", amount: 900, status: "CANCELLED" }),
    ]);

    expect(report.totals).toEqual({
      count: 3,
      refundCount: 2,
      gross: 380,
      refunded: 130,
      net: 250,
    });
    expect(report.methods).toEqual([
      {
        method: "POS",
        count: 1,
        refundCount: 1,
        gross: 200,
        refunded: 50,
        net: 150,
        pct: 60,
      },
      {
        method: "CASH",
        count: 2,
        refundCount: 1,
        gross: 180,
        refunded: 80,
        net: 100,
        pct: 40,
      },
    ]);
    expect(report.monthly).toEqual([
      { month: "2025-12", count: 1, refundCount: 0, gross: 80, refunded: 0, net: 80 },
      { month: "2026-01", count: 2, refundCount: 0, gross: 300, refunded: 0, net: 300 },
      { month: "2026-02", count: 0, refundCount: 1, gross: 0, refunded: 50, net: -50 },
      { month: "2026-03", count: 0, refundCount: 1, gross: 0, refunded: 80, net: -80 },
    ]);
  });

  it("filters gross and refunds independently by their own business dates", () => {
    const row = payment({
      // Stored payment days use UTC components: this remains 28 February.
      date: new Date("2026-02-28T22:30:00.000Z"),
      amount: 125,
      status: "REFUNDED",
      refundAmount: 25,
      // A real timestamp at the same instant is 1 March in Qatar.
      voidedAt: new Date("2026-02-28T22:30:00.000Z"),
    });

    expect(
      buildPaymentCashFlowReport([row], {
        from: "2026-02-01",
        to: "2026-02-28",
      }).totals,
    ).toEqual({ count: 1, refundCount: 0, gross: 125, refunded: 0, net: 125 });
    expect(
      buildPaymentCashFlowReport([row], {
        from: "2026-03-01",
        to: "2026-03-31",
      }).totals,
    ).toEqual({ count: 0, refundCount: 1, gross: 0, refunded: 25, net: -25 });
  });

  it("nets legacy undated refunds for lifetime without inventing a period date", () => {
    const oldRefund = payment({
      date: "2026-04-12T00:00:00.000Z",
      amount: 75,
      status: "REFUNDED",
      refundAmount: 75,
      voidedAt: null,
    });

    const lifetime = buildPaymentCashFlowReport([oldRefund]);
    expect(lifetime.totals).toEqual({
      count: 1,
      refundCount: 1,
      gross: 75,
      refunded: 75,
      net: 0,
    });
    expect(lifetime.monthly).toEqual([
      { month: "2026-04", count: 1, refundCount: 1, gross: 75, refunded: 75, net: 0 },
    ]);

    const april = buildPaymentCashFlowReport([oldRefund], {
      from: "2026-04-01",
      to: "2026-04-30",
    });
    expect(april.totals).toEqual({
      count: 1,
      refundCount: 0,
      gross: 75,
      refunded: 0,
      net: 75,
    });
  });

  it("ignores cancelled receipts and non-refund refund amounts", () => {
    const report = buildPaymentCashFlowReport([
      payment({ status: "CANCELLED", amount: 500, refundAmount: 100 }),
      payment({ status: "COMPLETED", amount: 60, refundAmount: 25 }),
    ]);

    expect(report.totals).toEqual({
      count: 1,
      refundCount: 0,
      gross: 60,
      refunded: 0,
      net: 60,
    });
  });

  it("returns empty report data for no records", () => {
    expect(buildPaymentCashFlowReport([])).toEqual({
      totals: { count: 0, refundCount: 0, gross: 0, refunded: 0, net: 0 },
      methods: [],
      monthly: [],
    });
  });
});
