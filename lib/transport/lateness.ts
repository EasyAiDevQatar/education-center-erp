// Controlled lateness: when may a plan deliver someone late, and is it worth it.
//
// Pure module (no imports beyond enum constants) so the rules are unit-tested
// rather than inferred from a board. Two questions are answered here and
// nowhere else:
//
//   1. How much lateness does THIS session tolerate? Resolved per session:
//      an explicit override wins, then the session type, then the centre
//      settings. An exam is strict whatever anyone configures.
//   2. Given a permitted delay, is the operational saving big enough to be
//      worth making somebody late? Lateness is never introduced for a rounding
//      error, so a delayed plan must clear a configured minimum saving.
//
// Deliberately NOT a severity ladder. DELAYED_EXCEPTION is not "a bad WARNING":
// it is a distinct outcome meaning "late on purpose, within policy, and it
// bought us something". A physically impossible trip is INVALID and can never
// become one.

import {
  STRICT_SESSION_TYPES,
  type SessionType,
  type TransportTimingPolicy,
} from "@/lib/enums";

export type LatenessOutcome = "VALID" | "WARNING" | "DELAYED_EXCEPTION" | "INVALID";

/** Centre-wide controlled-lateness configuration. */
export type LatenessConfig = {
  allowControlledLateness: boolean;
  defaultMaxLatenessMin: number;
  absoluteMaxLatenessMin: number;
  automaticLatenessApprovalMin: number;
  requireAdminApprovalAboveMin: number;
  minTripsSavedForDelay: number;
  minVehicleCountSavedForDelay: number;
  minEmptyKmSavedForDelay: number;
  minDriverMinutesSavedForDelay: number;
};

/** What a single session will tolerate, after everything is resolved. */
export type SessionLatenessPolicy = {
  policy: TransportTimingPolicy;
  /** Hard ceiling for this session, already clamped to the platform maximum. */
  maxLatenessMin: number;
  /** At or below this, an approved delay needs no human. */
  automaticUpToMin: number;
  requireApproval: boolean;
  notifyOnDelay: boolean;
  /** Set when the session type forced the policy regardless of overrides. */
  forcedByType: boolean;
};

/** Per-session overrides; every field null means "inherit". */
export type SessionPolicyInput = {
  sessionType: SessionType;
  transportTimingPolicy?: TransportTimingPolicy | null;
  maxAllowedLatenessMin?: number | null;
  requireDelayApproval?: boolean | null;
  notifyOnDelay?: boolean | null;
};

/** The lateness each policy allows before any per-session override. */
const POLICY_DEFAULT_MAX_MIN: Record<TransportTimingPolicy, number> = {
  STRICT: 0,
  FLEXIBLE: 30,
  VERY_FLEXIBLE: 30,
};

/** How much of that a policy will accept without a human saying yes. */
const POLICY_AUTOMATIC_MIN: Record<TransportTimingPolicy, number> = {
  STRICT: 0,
  FLEXIBLE: 10,
  VERY_FLEXIBLE: 30,
};

/** Sessions of these types are strict no matter what is configured. */
export function typeIsStrict(t: SessionType): boolean {
  return STRICT_SESSION_TYPES.includes(t);
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Resolve what one session tolerates: explicit override → session type →
 * centre settings, with the platform maximum as a hard ceiling throughout.
 */
export function resolveSessionPolicy(
  s: SessionPolicyInput,
  cfg: LatenessConfig,
): SessionLatenessPolicy {
  const ceiling = Math.max(0, cfg.absoluteMaxLatenessMin);

  // An exam is strict even if someone ticks FLEXIBLE on it. This is the one
  // place a per-session override is deliberately ignored.
  if (typeIsStrict(s.sessionType)) {
    return {
      policy: "STRICT",
      maxLatenessMin: 0,
      automaticUpToMin: 0,
      requireApproval: true,
      notifyOnDelay: s.notifyOnDelay ?? true,
      forcedByType: true,
    };
  }

  const policy: TransportTimingPolicy = s.transportTimingPolicy ?? "FLEXIBLE";

  // The session's own number wins; otherwise the policy's, bounded by the
  // centre default so raising a policy ceiling does not quietly raise the
  // centre's appetite for lateness.
  const fromPolicy = Math.min(POLICY_DEFAULT_MAX_MIN[policy], cfg.defaultMaxLatenessMin);
  const requested = s.maxAllowedLatenessMin ?? fromPolicy;
  const maxLatenessMin = cfg.allowControlledLateness ? clamp(requested, 0, ceiling) : 0;

  const automaticUpToMin = clamp(
    Math.min(POLICY_AUTOMATIC_MIN[policy], cfg.automaticLatenessApprovalMin),
    0,
    maxLatenessMin,
  );

  return {
    policy,
    maxLatenessMin,
    automaticUpToMin,
    requireApproval: s.requireDelayApproval ?? policy !== "VERY_FLEXIBLE",
    notifyOnDelay: s.notifyOnDelay ?? true,
    forcedByType: false,
  };
}

/** What a delayed plan saves against the on-time one. */
export type OperationalSaving = {
  tripsSaved: number;
  vehiclesSaved: number;
  emptyKmSaved: number;
  totalKmSaved: number;
  driverMinutesSaved: number;
};

export const NO_SAVING: OperationalSaving = {
  tripsSaved: 0,
  vehiclesSaved: 0,
  emptyKmSaved: 0,
  totalKmSaved: 0,
  driverMinutesSaved: 0,
};

/**
 * Is the saving big enough to justify making someone late?
 *
 * Any ONE threshold being met is enough — saving a whole trip matters even if
 * it saves no empty kilometres. But nothing counts if every measure is below
 * its minimum, which is what stops a two-minute delay being sold as an
 * optimisation.
 */
export function savingIsMeaningful(s: OperationalSaving, cfg: LatenessConfig): boolean {
  return (
    (cfg.minTripsSavedForDelay > 0 && s.tripsSaved >= cfg.minTripsSavedForDelay) ||
    (cfg.minVehicleCountSavedForDelay > 0 &&
      s.vehiclesSaved >= cfg.minVehicleCountSavedForDelay) ||
    (cfg.minEmptyKmSavedForDelay > 0 && s.emptyKmSaved >= cfg.minEmptyKmSavedForDelay) ||
    (cfg.minDriverMinutesSavedForDelay > 0 &&
      s.driverMinutesSaved >= cfg.minDriverMinutesSavedForDelay)
  );
}

export type LatenessDecision = {
  outcome: LatenessOutcome;
  /** Minutes past the session start the passenger is expected to arrive. */
  latenessMin: number;
  /** The ceiling that applied, for display next to the delay. */
  maxAllowedMin: number;
  requiresApproval: boolean;
  /** Machine-readable why, for the board and the audit trail. */
  reason:
    | "onTime"
    | "withinPolicy"
    | "needsApproval"
    | "exceedsPolicy"
    | "policyStrict"
    | "latenessDisabled"
    | "savingTooSmall"
    | "physicallyImpossible";
};

/**
 * Classify one proposed arrival.
 *
 * `physicallyInfeasible` is passed in rather than inferred: a trip that breaks
 * capacity, turnaround, a shift or the road network is INVALID for reasons that
 * have nothing to do with policy, and must never be laundered into an accepted
 * delay by a generous setting.
 */
export function classifyLateness(args: {
  latenessMin: number;
  policy: SessionLatenessPolicy;
  config: LatenessConfig;
  saving: OperationalSaving;
  physicallyInfeasible?: boolean;
}): LatenessDecision {
  const { latenessMin, policy, config, saving } = args;
  const max = policy.maxLatenessMin;

  const base = { latenessMin, maxAllowedMin: max };

  if (args.physicallyInfeasible) {
    return { ...base, outcome: "INVALID", requiresApproval: false, reason: "physicallyImpossible" };
  }

  if (latenessMin <= 0) {
    return { ...base, outcome: "VALID", requiresApproval: false, reason: "onTime" };
  }

  if (!config.allowControlledLateness) {
    return { ...base, outcome: "INVALID", requiresApproval: false, reason: "latenessDisabled" };
  }

  if (policy.policy === "STRICT" || max <= 0) {
    return { ...base, outcome: "INVALID", requiresApproval: false, reason: "policyStrict" };
  }

  // Past the session's ceiling (itself never above the platform maximum).
  if (latenessMin > max) {
    return { ...base, outcome: "INVALID", requiresApproval: false, reason: "exceedsPolicy" };
  }

  // Permitted, but only if it bought something. Otherwise this is just a late
  // trip, and a late trip with no upside is a defect, not an exception.
  if (!savingIsMeaningful(saving, config)) {
    return { ...base, outcome: "INVALID", requiresApproval: false, reason: "savingTooSmall" };
  }

  const needsHuman =
    latenessMin > policy.automaticUpToMin ||
    latenessMin > config.requireAdminApprovalAboveMin ||
    policy.requireApproval;

  return {
    ...base,
    outcome: "DELAYED_EXCEPTION",
    requiresApproval: needsHuman,
    reason: needsHuman ? "needsApproval" : "withinPolicy",
  };
}

/** Defaults for a centre that has not configured controlled lateness yet. */
export const DEFAULT_LATENESS_CONFIG: LatenessConfig = {
  allowControlledLateness: false, // opt-in: nobody is delayed until asked for
  defaultMaxLatenessMin: 10,
  absoluteMaxLatenessMin: 30,
  automaticLatenessApprovalMin: 10,
  requireAdminApprovalAboveMin: 10,
  minTripsSavedForDelay: 1,
  minVehicleCountSavedForDelay: 1,
  minEmptyKmSavedForDelay: 10,
  minDriverMinutesSavedForDelay: 30,
};
