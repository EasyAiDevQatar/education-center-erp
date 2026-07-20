/** Lead pipeline constants and pure helpers (no DB access — unit tested). */

export const LEAD_STATUSES = ["NEW", "CONTACTED", "TRIAL", "ENROLLED", "LOST"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Columns shown on the board, in pipeline order. */
export const LEAD_BOARD_ORDER: LeadStatus[] = ["NEW", "CONTACTED", "TRIAL", "ENROLLED", "LOST"];

/** Statuses that still need chasing — the ones a follow-up date matters for. */
export const OPEN_LEAD_STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "TRIAL"];

export type FollowUpState = "none" | "upcoming" | "dueToday" | "overdue";

/**
 * How urgent a lead's follow-up is, relative to `today` (both YYYY-MM-DD).
 *
 * Closed leads never nag: once someone has enrolled or been lost, a stale
 * follow-up date is history, not a task.
 */
export function followUpState(
  followUpAt: string | null | undefined,
  status: string,
  today: string,
): FollowUpState {
  if (!followUpAt) return "none";
  if (!OPEN_LEAD_STATUSES.includes(status as LeadStatus)) return "none";
  if (followUpAt < today) return "overdue";
  if (followUpAt === today) return "dueToday";
  return "upcoming";
}

/**
 * Funnel counts for the dashboard.
 *
 * `converted` is the share of *decided* leads that enrolled — leads still in
 * play aren't failures yet, so counting them in the denominator would make a
 * healthy pipeline look like a bad one.
 */
export function funnelCounts(leads: { status: string }[]) {
  const by = (s: LeadStatus) => leads.filter((l) => l.status === s).length;
  const enrolled = by("ENROLLED");
  const lost = by("LOST");
  const decided = enrolled + lost;
  return {
    new: by("NEW"),
    contacted: by("CONTACTED"),
    trial: by("TRIAL"),
    enrolled,
    lost,
    total: leads.length,
    conversionRate: decided > 0 ? Math.round((enrolled / decided) * 1000) / 10 : 0,
  };
}
