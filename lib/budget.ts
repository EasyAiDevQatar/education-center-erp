/**
 * Pure budgeting and break-even calculations.
 *
 * This module deliberately has no database or UI dependencies. The query layer
 * decides which sessions are earned/billable and which payment/refund rows are
 * cash; this layer only reconciles those already-truthful figures with a plan.
 */

export type BudgetNumber =
  | number
  | string
  | { toString(): string }
  | null
  | undefined;

export type BreakEvenInput = {
  /** Costs that do not change with teaching volume. */
  fixedExpenses: BudgetNumber;
  /** Costs expected to move with teaching volume. */
  variableExpenses: BudgetNumber;
  /** Revenue used to estimate the variable-cost and contribution ratios. */
  incomeBasis: BudgetNumber;
  /** Revenue position to compare with break-even (normally booked tuition forecast). */
  comparisonIncome?: BudgetNumber;
  /** Optional average selling price for one student-session. */
  averageRevenuePerSession?: BudgetNumber;
};

export type BreakEvenMetrics = {
  /** Variable expenses divided by the income basis. */
  variableCostRatio: number | null;
  /** The share of each revenue unit available to cover fixed expenses. */
  contributionMarginRatio: number | null;
  averageRevenuePerSession: number | null;
  variableExpensePerSession: number | null;
  contributionMarginPerSession: number | null;
  /** Revenue required to cover fixed and variable expenses. */
  breakEvenRevenue: number | null;
  /** Student-sessions required at the supplied average price. */
  breakEvenSessions: number | null;
  /** Additional forecast revenue required from the comparison position. */
  additionalRevenueNeeded: number | null;
  /** Additional student-sessions required at the supplied average price. */
  additionalSessionsNeeded: number | null;
};

export type BudgetPeriodInput = {
  plannedIncome?: BudgetNumber;
  plannedFixedExpenses?: BudgetNumber;
  plannedVariableExpenses?: BudgetNumber;
  projectedIncome?: BudgetNumber;
  projectedExpenses?: BudgetNumber;
  /** Forecast per-student session rows behind `projectedIncome`. */
  forecastSessions?: BudgetNumber;
  earnedIncome?: BudgetNumber;
  /** Net collections after refunds. Unlike the other source figures, this may be negative. */
  cashCollected?: BudgetNumber;
  actualExpenses?: BudgetNumber;
  /** Planned student-session volume used to turn revenue break-even into a session count. */
  targetSessions?: BudgetNumber;
  /** Earned/billable per-student session rows; group size is handled by the query layer. */
  billableSessions?: BudgetNumber;
};

export type BudgetMonthInput = BudgetPeriodInput & {
  /** Canonical calendar month (`YYYY-MM`). */
  month: string;
};

export type BudgetPeriodMetrics = {
  plannedIncome: number;
  plannedFixedExpenses: number;
  plannedVariableExpenses: number;
  plannedExpenses: number;
  plannedSurplus: number;
  projectedIncome: number;
  projectedExpenses: number;
  projectedSurplus: number;
  forecastSessions: number;
  earnedIncome: number;
  cashCollected: number;
  actualExpenses: number;
  actualSurplus: number;
  targetSessions: number;
  billableSessions: number;
  /** Positive means the income forecast is ahead of plan. */
  projectedIncomeVariance: number;
  /** Positive means projected spending is under budget. */
  projectedExpenseVariance: number;
  projectedSurplusVariance: number;
  /** Positive means earned revenue is ahead of the full-period plan. */
  earnedIncomeVariance: number;
  /** Positive means actual spending is under budget. */
  actualExpenseVariance: number;
  actualSurplusVariance: number;
  /** Earned but not yet collected. A negative value means collections lead earnings. */
  collectionGap: number;
  breakEven: BreakEvenMetrics;
};

export type BudgetMonthMetrics = BudgetPeriodMetrics & { month: string };

export type BudgetReport = {
  months: BudgetMonthMetrics[];
  /** Sum of the selected months, with ratios and break-even recomputed from those sums. */
  annual: BudgetPeriodMetrics;
};

/**
 * Whether a session belongs in booked-tuition forecasts.
 *
 * Forecasting is deliberately stricter than an inverse "not cancelled" test:
 * draft and unknown/future workflow states cannot silently become revenue.
 * No-shows follow the centre's billing policy.
 */
export function isForecastableSession(
  status: string,
  chargeNoShow: boolean,
): boolean {
  if (
    status === "SCHEDULED" ||
    status === "CHECKED_IN" ||
    status === "COMPLETED"
  ) {
    return true;
  }
  return status === "NO_SHOW" && chargeNoShow;
}

type NormalizedBudgetPeriod = {
  plannedIncome: number;
  plannedFixedExpenses: number;
  plannedVariableExpenses: number;
  projectedIncome: number;
  projectedExpenses: number;
  forecastSessions: number;
  earnedIncome: number;
  cashCollected: number;
  actualExpenses: number;
  targetSessions: number;
  billableSessions: number;
};

function parsedNumber(value: BudgetNumber): number {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

function amount(value: BudgetNumber): number {
  return Math.max(0, parsedNumber(value));
}

function count(value: BudgetNumber): number {
  return Math.floor(amount(value));
}

function roundMoney(value: number): number {
  const rounded = Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  return value < 0 ? -rounded : rounded;
}

function roundRatio(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function sessionsForRevenue(revenue: number, averageRevenue: number): number {
  if (revenue <= 0) return 0;
  // Avoid an extra session caused only by IEEE-754 noise at an exact boundary.
  return Math.ceil(revenue / averageRevenue - 1e-10);
}

/**
 * Calculates contribution-margin break-even figures.
 *
 * A missing/non-positive income basis cannot establish a variable-cost ratio.
 * Likewise, a zero or negative contribution margin can never cover fixed
 * expenses. Both cases return `null` rather than a misleading zero or infinity.
 * The gap is measured against `comparisonIncome`; budgeting passes the booked
 * tuition forecast so future sessions count, while earned income remains an
 * independent actual-performance figure.
 */
export function calculateBreakEven(input: BreakEvenInput): BreakEvenMetrics {
  const fixedExpenses = amount(input.fixedExpenses);
  const variableExpenses = amount(input.variableExpenses);
  const incomeBasis = amount(input.incomeBasis);
  const comparisonIncome = amount(input.comparisonIncome);
  const averageRevenue = amount(input.averageRevenuePerSession);

  if (incomeBasis <= 0) {
    return {
      variableCostRatio: null,
      contributionMarginRatio: null,
      averageRevenuePerSession: averageRevenue > 0 ? roundMoney(averageRevenue) : null,
      variableExpensePerSession: null,
      contributionMarginPerSession: null,
      breakEvenRevenue: null,
      breakEvenSessions: null,
      additionalRevenueNeeded: null,
      additionalSessionsNeeded: null,
    };
  }

  const variableCostRatio = variableExpenses / incomeBasis;
  const contributionMarginRatio = 1 - variableCostRatio;
  if (contributionMarginRatio <= 0) {
    return {
      variableCostRatio: roundRatio(variableCostRatio),
      contributionMarginRatio: null,
      averageRevenuePerSession: averageRevenue > 0 ? roundMoney(averageRevenue) : null,
      variableExpensePerSession: null,
      contributionMarginPerSession: null,
      breakEvenRevenue: null,
      breakEvenSessions: null,
      additionalRevenueNeeded: null,
      additionalSessionsNeeded: null,
    };
  }

  const rawBreakEvenRevenue = fixedExpenses / contributionMarginRatio;
  const rawAdditionalRevenue = Math.max(0, rawBreakEvenRevenue - comparisonIncome);
  const breakEvenRevenue = roundMoney(rawBreakEvenRevenue);
  const additionalRevenueNeeded = roundMoney(rawAdditionalRevenue);
  const hasSessionBasis = averageRevenue > 0;
  const variableExpensePerSession = hasSessionBasis
    ? roundMoney(averageRevenue * variableCostRatio)
    : null;
  const contributionMarginPerSession = hasSessionBasis
    ? roundMoney(averageRevenue * contributionMarginRatio)
    : null;

  return {
    variableCostRatio: roundRatio(variableCostRatio),
    contributionMarginRatio: roundRatio(contributionMarginRatio),
    averageRevenuePerSession: hasSessionBasis ? roundMoney(averageRevenue) : null,
    variableExpensePerSession,
    contributionMarginPerSession,
    breakEvenRevenue,
    breakEvenSessions: hasSessionBasis
      ? sessionsForRevenue(rawBreakEvenRevenue, averageRevenue)
      : rawBreakEvenRevenue === 0
        ? 0
        : null,
    additionalRevenueNeeded,
    additionalSessionsNeeded: hasSessionBasis
      ? sessionsForRevenue(rawAdditionalRevenue, averageRevenue)
      : rawAdditionalRevenue === 0
        ? 0
        : null,
  };
}

function normalizedInput(input: BudgetPeriodInput): NormalizedBudgetPeriod {
  return {
    plannedIncome: amount(input.plannedIncome),
    plannedFixedExpenses: amount(input.plannedFixedExpenses),
    plannedVariableExpenses: amount(input.plannedVariableExpenses),
    projectedIncome: amount(input.projectedIncome),
    projectedExpenses: amount(input.projectedExpenses),
    forecastSessions: count(input.forecastSessions),
    earnedIncome: amount(input.earnedIncome),
    // Refund-heavy months can have negative net cash and must remain truthful.
    cashCollected: parsedNumber(input.cashCollected),
    actualExpenses: amount(input.actualExpenses),
    targetSessions: count(input.targetSessions),
    billableSessions: count(input.billableSessions),
  };
}

/** Build all comparison and break-even metrics for one month or a summed period. */
export function calculateBudgetPeriod(input: BudgetPeriodInput): BudgetPeriodMetrics {
  const values = normalizedInput(input);
  const plannedIncome = roundMoney(values.plannedIncome);
  const plannedFixedExpenses = roundMoney(values.plannedFixedExpenses);
  const plannedVariableExpenses = roundMoney(values.plannedVariableExpenses);
  const projectedIncome = roundMoney(values.projectedIncome);
  const projectedExpenses = roundMoney(values.projectedExpenses);
  const earnedIncome = roundMoney(values.earnedIncome);
  const cashCollected = roundMoney(values.cashCollected);
  const actualExpenses = roundMoney(values.actualExpenses);
  const plannedExpenses = roundMoney(
    plannedFixedExpenses + plannedVariableExpenses,
  );
  const plannedSurplus = roundMoney(plannedIncome - plannedExpenses);
  const projectedSurplus = roundMoney(projectedIncome - projectedExpenses);
  const actualSurplus = roundMoney(earnedIncome - actualExpenses);

  // Current forecast value/count is the closest available selling-price basis.
  // The explicit plan and actual earned work are truthful fallbacks when the
  // forecast is empty. Annual inputs are summed before this division, giving a
  // revenue-weighted average instead of an average of monthly prices.
  const averageRevenuePerSession =
    values.forecastSessions > 0 && projectedIncome > 0
      ? projectedIncome / values.forecastSessions
      : values.targetSessions > 0 && plannedIncome > 0
        ? plannedIncome / values.targetSessions
        : values.billableSessions > 0 && earnedIncome > 0
          ? earnedIncome / values.billableSessions
          : 0;

  return {
    plannedIncome,
    plannedFixedExpenses,
    plannedVariableExpenses,
    plannedExpenses,
    plannedSurplus,
    projectedIncome,
    projectedExpenses,
    projectedSurplus,
    forecastSessions: values.forecastSessions,
    earnedIncome,
    cashCollected,
    actualExpenses,
    actualSurplus,
    targetSessions: values.targetSessions,
    billableSessions: values.billableSessions,
    projectedIncomeVariance: roundMoney(projectedIncome - plannedIncome),
    projectedExpenseVariance: roundMoney(plannedExpenses - projectedExpenses),
    projectedSurplusVariance: roundMoney(projectedSurplus - plannedSurplus),
    earnedIncomeVariance: roundMoney(earnedIncome - plannedIncome),
    actualExpenseVariance: roundMoney(plannedExpenses - actualExpenses),
    actualSurplusVariance: roundMoney(actualSurplus - plannedSurplus),
    collectionGap: roundMoney(earnedIncome - cashCollected),
    breakEven: calculateBreakEven({
      fixedExpenses: plannedFixedExpenses,
      variableExpenses: plannedVariableExpenses,
      incomeBasis: plannedIncome,
      comparisonIncome: projectedIncome,
      averageRevenuePerSession,
    }),
  };
}

function sumInputs(inputs: BudgetPeriodInput[]): NormalizedBudgetPeriod {
  const total = normalizedInput({});
  for (const input of inputs) {
    const row = normalizedInput(input);
    total.plannedIncome += row.plannedIncome;
    total.plannedFixedExpenses += row.plannedFixedExpenses;
    total.plannedVariableExpenses += row.plannedVariableExpenses;
    total.projectedIncome += row.projectedIncome;
    total.projectedExpenses += row.projectedExpenses;
    total.forecastSessions += row.forecastSessions;
    total.earnedIncome += row.earnedIncome;
    total.cashCollected += row.cashCollected;
    total.actualExpenses += row.actualExpenses;
    total.targetSessions += row.targetSessions;
    total.billableSessions += row.billableSessions;
  }
  return total;
}

/**
 * Builds chronological month rows plus a selected-period summary.
 *
 * The annual ratios are recomputed from summed money/session bases. They are
 * intentionally not averages of monthly percentages, which would overweight
 * small months and can materially misstate break-even.
 */
export function buildBudgetReport(inputs: BudgetMonthInput[]): BudgetReport {
  const sorted = [...inputs].sort((a, b) => a.month.localeCompare(b.month));
  return {
    months: sorted.map((input) => ({
      month: input.month,
      ...calculateBudgetPeriod(input),
    })),
    annual: calculateBudgetPeriod(sumInputs(sorted)),
  };
}
