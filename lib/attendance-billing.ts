/**
 * Attendance duration is an operational fact; billable duration is a centre
 * policy. Keeping the calculation pure makes the settings preview, checkout,
 * package drawdown and tests use exactly the same rules.
 */

export const BILLABLE_BASES = ["PLANNED", "ACTUAL"] as const;
export type BillableBasis = (typeof BILLABLE_BASES)[number];

export const BILLABLE_ROUNDING_MODES = ["NEAREST", "UP", "DOWN"] as const;
export type BillableRoundingMode = (typeof BILLABLE_ROUNDING_MODES)[number];

export const BILLABLE_ROUNDING_MINUTES = [1, 5, 15, 30, 60] as const;

export type BillablePolicy = {
  basis: BillableBasis;
  roundingMinutes: number;
  roundingMode: BillableRoundingMode;
  minimumMinutes: number;
  capAtPlanned: boolean;
};

/** Planned duration preserves the centre's existing financial behaviour. */
export const DEFAULT_BILLABLE_POLICY: BillablePolicy = {
  basis: "PLANNED",
  roundingMinutes: 1,
  roundingMode: "NEAREST",
  minimumMinutes: 0,
  capAtPlanned: false,
};

export const BILLABLE_SETTING_KEYS = [
  "attendanceBillableBasis",
  "attendanceBillableRoundingMinutes",
  "attendanceBillableRoundingMode",
  "attendanceMinimumBillableMinutes",
  "attendanceCapBillableAtPlanned",
] as const;

export function resolveBillablePolicy(
  settings: Partial<Record<(typeof BILLABLE_SETTING_KEYS)[number], string>>,
): BillablePolicy {
  const basis = BILLABLE_BASES.includes(settings.attendanceBillableBasis as BillableBasis)
    ? (settings.attendanceBillableBasis as BillableBasis)
    : DEFAULT_BILLABLE_POLICY.basis;
  const roundingMode = BILLABLE_ROUNDING_MODES.includes(
    settings.attendanceBillableRoundingMode as BillableRoundingMode,
  )
    ? (settings.attendanceBillableRoundingMode as BillableRoundingMode)
    : DEFAULT_BILLABLE_POLICY.roundingMode;
  const requestedRounding = Number(settings.attendanceBillableRoundingMinutes);
  const roundingMinutes = (BILLABLE_ROUNDING_MINUTES as readonly number[]).includes(
    requestedRounding,
  )
    ? requestedRounding
    : DEFAULT_BILLABLE_POLICY.roundingMinutes;
  const requestedMinimum = Number(settings.attendanceMinimumBillableMinutes);
  const minimumMinutes = Number.isFinite(requestedMinimum)
    ? Math.min(1440, Math.max(0, Math.round(requestedMinimum)))
    : DEFAULT_BILLABLE_POLICY.minimumMinutes;

  return {
    basis,
    roundingMinutes,
    roundingMode,
    minimumMinutes,
    capAtPlanned: settings.attendanceCapBillableAtPlanned === "true",
  };
}

export function calculateBillableMinutes(
  input: { plannedHours: number; actualMinutes: number | null },
  policy: BillablePolicy,
): number {
  const plannedMinutes = Math.max(0, Math.round(input.plannedHours * 60));
  const measuredMinutes =
    input.actualMinutes == null ? null : Math.max(0, Math.round(input.actualMinutes));
  // A session confirmed without a checkout has no measurement. Falling back
  // to planned duration avoids silently turning a taught lesson into zero.
  const raw = policy.basis === "ACTUAL" && measuredMinutes != null
    ? measuredMinutes
    : plannedMinutes;
  const unit = policy.roundingMinutes;
  const scaled = raw / unit;
  const roundedUnits = policy.roundingMode === "UP"
    ? Math.ceil(scaled)
    : policy.roundingMode === "DOWN"
      ? Math.floor(scaled)
      : Math.round(scaled);
  let result = Math.max(policy.minimumMinutes, roundedUnits * unit);
  // A cap is an explicit maximum and therefore wins over the minimum.
  if (policy.capAtPlanned) result = Math.min(result, plannedMinutes);
  return Math.max(0, Math.round(result));
}
