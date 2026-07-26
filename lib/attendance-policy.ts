/** Pure attendance-money rules — no DB, no server-only, so they are testable. */

/**
 * What a session becomes when the student does not turn up.
 *
 * CANCELLED treats the slot as not delivered: the student is charged nothing and
 * the teacher earns nothing on it. TAUGHT treats the slot as delivered anyway —
 * the teacher was there, the room was held — so it bills normally.
 *
 * CANCELLED is the default. It is the answer that cannot quietly take money
 * from a parent for a lesson nobody gave, and the reverse mistake (failing to
 * charge for a slot the centre did hold) is visible to the office in a way an
 * unnoticed charge is not.
 *
 * Note this decides money only, never the status itself. The session stays
 * NO_SHOW, because "the student did not come" is what happened and reports need
 * to say so; a centre that bills for no-shows still wants them counted as
 * absences rather than relabelled as taught.
 */
export const NO_SHOW_POLICIES = ["CANCELLED", "TAUGHT"] as const;
export type NoShowPolicy = (typeof NO_SHOW_POLICIES)[number];

export const DEFAULT_NO_SHOW_POLICY: NoShowPolicy = "CANCELLED";

export function isNoShowPolicy(v: unknown): v is NoShowPolicy {
  return typeof v === "string" && (NO_SHOW_POLICIES as readonly string[]).includes(v);
}

/** Stored value to policy, defaulting rather than throwing on anything stale. */
export function resolveNoShowPolicy(v: string | null | undefined): NoShowPolicy {
  return isNoShowPolicy(v) ? v : DEFAULT_NO_SHOW_POLICY;
}

/** Whether a no-show earns money — the student's bill and the teacher's cut. */
export function noShowIsChargeable(policy: NoShowPolicy): boolean {
  return policy === "TAUGHT";
}

/**
 * Add NO_SHOW to a query's excluded statuses when it earns nothing.
 *
 * Callers pass their own base list because the money paths legitimately differ:
 * billing already ignores CANCELLED, payroll historically does not. Taking a
 * base rather than inventing one keeps this from silently changing a rule it
 * was not asked about.
 */
export function unbilledStatuses(policy: NoShowPolicy, base: readonly string[]): string[] {
  return noShowIsChargeable(policy) ? [...base] : [...base, "NO_SHOW"];
}
