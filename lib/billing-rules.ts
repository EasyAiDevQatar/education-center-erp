/** Pure billing rules — no DB, no server-only, so they are unit-testable. */

/** Payment status implied by how much of a session's total has been allocated. */
export function paymentStatusFor(
  total: number,
  allocated: number,
): "PAID" | "PARTIAL" | "UNPAID" {
  if (allocated <= 0) return "UNPAID";
  // Tolerate sub-qirsh float drift so 175 === 174.999 still reads as PAID.
  if (allocated + 0.005 >= total) return "PAID";
  return "PARTIAL";
}

/** Package status implied by consumption and expiry (exhaustion wins over expiry). */
export function packageStatusFor(
  totalHours: number,
  hoursUsed: number,
  expiresAt: Date | null,
  now: Date = new Date(),
): "ACTIVE" | "COMPLETED" | "EXPIRED" {
  if (hoursUsed + 1e-9 >= totalHours) return "COMPLETED";
  if (expiresAt && expiresAt < now) return "EXPIRED";
  return "ACTIVE";
}

/**
 * Spread a payment across sessions oldest-first, never exceeding each session's
 * outstanding balance nor the payment amount.
 */
export function autoAllocate(
  amount: number,
  sessions: { id: string; outstanding: number }[],
): { sessionId: string; amount: number }[] {
  let left = amount;
  const out: { sessionId: string; amount: number }[] = [];
  for (const s of sessions) {
    if (left <= 0.005) break;
    const take = Math.min(left, s.outstanding);
    if (take > 0.005) {
      out.push({ sessionId: s.id, amount: Math.round(take * 100) / 100 });
      left -= take;
    }
  }
  return out;
}
