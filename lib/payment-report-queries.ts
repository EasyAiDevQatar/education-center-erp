import "server-only";

import { db } from "./db";
import {
  buildPaymentCashFlowReport,
  type PaymentCashFlowReport,
} from "./payment-cash-flow";

export type ReportingDateRange = { from?: Date; to?: Date };

/**
 * Cash movements for operational and financial reports.
 *
 * Receipt dates are stored business dates. Refunds belong to the Qatar date of
 * their real `voidedAt` timestamp, so bounded queries also load refund records
 * whose original receipt may fall outside the selected period.
 */
export async function getPaymentCashFlow(
  range?: ReportingDateRange,
): Promise<PaymentCashFlowReport> {
  const date = range?.from || range?.to
    ? { gte: range.from, lte: range.to }
    : undefined;
  const payments = await db.payment.findMany({
    where: date
      ? {
          OR: [
            { date, status: { not: "CANCELLED" } },
            { status: "REFUNDED" },
          ],
        }
      : { status: { not: "CANCELLED" } },
    select: {
      date: true,
      method: true,
      amount: true,
      status: true,
      refundAmount: true,
      voidedAt: true,
    },
  });

  return buildPaymentCashFlowReport(payments, {
    from: range?.from?.toISOString().slice(0, 10),
    to: range?.to?.toISOString().slice(0, 10),
  });
}
