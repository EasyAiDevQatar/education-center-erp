import { describe, expect, it } from "vitest";
import {
  buildBudgetReport,
  calculateBreakEven,
  calculateBudgetPeriod,
  isForecastableSession,
  type BudgetMonthInput,
} from "@/lib/budget";

describe("budget session forecasting policy", () => {
  it.each([
    ["SCHEDULED", false, true],
    ["SCHEDULED", true, true],
    ["CHECKED_IN", false, true],
    ["CHECKED_IN", true, true],
    ["COMPLETED", false, true],
    ["COMPLETED", true, true],
    ["NO_SHOW", false, false],
    ["NO_SHOW", true, true],
    ["DRAFT", false, false],
    ["DRAFT", true, false],
    ["CANCELLED", false, false],
    ["CANCELLED", true, false],
    ["REFUNDED", false, false],
    ["UNKNOWN", true, false],
    ["", true, false],
  ] as const)(
    "%s with charge-no-show=%s returns %s",
    (status, chargeNoShow, expected) => {
      expect(isForecastableSession(status, chargeNoShow)).toBe(expected);
    },
  );
});

describe("budget period calculations", () => {
  it("keeps plan, forecast, earned income, cash and actual expenses distinct", () => {
    const result = calculateBudgetPeriod({
      plannedIncome: 20_000,
      plannedFixedExpenses: 10_000,
      plannedVariableExpenses: 4_000,
      projectedIncome: 22_000,
      projectedExpenses: 15_000,
      forecastSessions: 220,
      earnedIncome: 8_000,
      cashCollected: 6_000,
      actualExpenses: 5_000,
      targetSessions: 200,
      billableSessions: 80,
    });

    expect(result).toMatchObject({
      plannedIncome: 20_000,
      plannedFixedExpenses: 10_000,
      plannedVariableExpenses: 4_000,
      plannedExpenses: 14_000,
      plannedSurplus: 6_000,
      projectedIncome: 22_000,
      projectedExpenses: 15_000,
      projectedSurplus: 7_000,
      forecastSessions: 220,
      earnedIncome: 8_000,
      cashCollected: 6_000,
      actualExpenses: 5_000,
      actualSurplus: 3_000,
      targetSessions: 200,
      billableSessions: 80,
      projectedIncomeVariance: 2_000,
      projectedExpenseVariance: -1_000,
      projectedSurplusVariance: 1_000,
      earnedIncomeVariance: -12_000,
      actualExpenseVariance: 9_000,
      actualSurplusVariance: -3_000,
      collectionGap: 2_000,
    });
    expect(result.breakEven).toEqual({
      variableCostRatio: 0.2,
      contributionMarginRatio: 0.8,
      averageRevenuePerSession: 100,
      variableExpensePerSession: 20,
      contributionMarginPerSession: 80,
      breakEvenRevenue: 12_500,
      breakEvenSessions: 125,
      // Booked forecast is already above break-even even though only 8,000 has
      // been earned so far; future plans must not look falsely short.
      additionalRevenueNeeded: 0,
      additionalSessionsNeeded: 0,
    });
  });

  it("uses actual earned student-sessions as a price fallback for a sparse plan", () => {
    const result = calculateBudgetPeriod({
      plannedIncome: 3_000,
      plannedFixedExpenses: 1_200,
      plannedVariableExpenses: 600,
      projectedIncome: 750,
      earnedIncome: 750,
      billableSessions: 5,
    });

    expect(result.breakEven).toMatchObject({
      averageRevenuePerSession: 150,
      breakEvenRevenue: 1_500,
      breakEvenSessions: 10,
      additionalRevenueNeeded: 750,
      additionalSessionsNeeded: 5,
    });
  });

  it("prefers the forecast value and count as the current average selling price", () => {
    const result = calculateBudgetPeriod({
      plannedIncome: 1_200,
      plannedFixedExpenses: 600,
      plannedVariableExpenses: 240,
      targetSessions: 12,
      projectedIncome: 900,
      forecastSessions: 6,
      earnedIncome: 400,
      billableSessions: 4,
    });

    // Plan and earned averages are both 100, while the currently forecast
    // sessions average 150. The forecast is the most truthful current basis.
    expect(result.breakEven).toMatchObject({
      averageRevenuePerSession: 150,
      breakEvenRevenue: 750,
      breakEvenSessions: 5,
      additionalRevenueNeeded: 0,
      additionalSessionsNeeded: 0,
    });
  });

  it("keeps refund-heavy net cash negative instead of hiding it", () => {
    const result = calculateBudgetPeriod({
      plannedIncome: 500,
      cashCollected: -125,
      earnedIncome: 200,
    });

    expect(result.cashCollected).toBe(-125);
    expect(result.collectionGap).toBe(325);
  });

  it("normalizes invalid, negative and fractional count input defensively", () => {
    const result = calculateBudgetPeriod({
      plannedIncome: "not a number",
      plannedFixedExpenses: -10,
      plannedVariableExpenses: { toString: () => "25.755" },
      projectedIncome: Number.POSITIVE_INFINITY,
      cashCollected: Number.NaN,
      forecastSessions: "8.7",
      targetSessions: "12.9",
      billableSessions: -3,
    });

    expect(result).toMatchObject({
      plannedIncome: 0,
      plannedFixedExpenses: 0,
      plannedVariableExpenses: 25.76,
      projectedIncome: 0,
      cashCollected: 0,
      forecastSessions: 8,
      targetSessions: 12,
      billableSessions: 0,
    });
  });
});

describe("break-even safeguards", () => {
  it("returns null when there is no revenue basis", () => {
    expect(
      calculateBreakEven({
        fixedExpenses: 500,
        variableExpenses: 100,
        incomeBasis: 0,
        averageRevenuePerSession: 125,
      }),
    ).toEqual({
      variableCostRatio: null,
      contributionMarginRatio: null,
      averageRevenuePerSession: 125,
      variableExpensePerSession: null,
      contributionMarginPerSession: null,
      breakEvenRevenue: null,
      breakEvenSessions: null,
      additionalRevenueNeeded: null,
      additionalSessionsNeeded: null,
    });
  });

  it("returns null rather than infinity for a non-positive contribution margin", () => {
    expect(
      calculateBreakEven({
        fixedExpenses: 500,
        variableExpenses: 1_000,
        incomeBasis: 1_000,
        averageRevenuePerSession: 100,
      }),
    ).toEqual({
      variableCostRatio: 1,
      contributionMarginRatio: null,
      averageRevenuePerSession: 100,
      variableExpensePerSession: null,
      contributionMarginPerSession: null,
      breakEvenRevenue: null,
      breakEvenSessions: null,
      additionalRevenueNeeded: null,
      additionalSessionsNeeded: null,
    });
  });

  it("reports immediate break-even when there are no fixed expenses", () => {
    expect(
      calculateBreakEven({
        fixedExpenses: 0,
        variableExpenses: 200,
        incomeBasis: 1_000,
      }),
    ).toMatchObject({
      contributionMarginRatio: 0.8,
      breakEvenRevenue: 0,
      breakEvenSessions: 0,
      additionalRevenueNeeded: 0,
      additionalSessionsNeeded: 0,
    });
  });

  it("leaves session counts null when price has no basis", () => {
    expect(
      calculateBreakEven({
        fixedExpenses: 1_000,
        variableExpenses: 500,
        incomeBasis: 2_000,
      }),
    ).toMatchObject({
      breakEvenRevenue: 1_333.33,
      breakEvenSessions: null,
      additionalRevenueNeeded: 1_333.33,
      additionalSessionsNeeded: null,
    });
  });

  it("measures the remaining gap against the supplied forecast position", () => {
    expect(
      calculateBreakEven({
        fixedExpenses: 1_000,
        variableExpenses: 0,
        incomeBasis: 2_000,
        comparisonIncome: 600,
        averageRevenuePerSession: 100,
      }),
    ).toMatchObject({
      breakEvenRevenue: 1_000,
      breakEvenSessions: 10,
      additionalRevenueNeeded: 400,
      additionalSessionsNeeded: 4,
    });
  });

  it("rounds displayed money without undercounting required sessions", () => {
    const result = calculateBreakEven({
      fixedExpenses: 100.01,
      variableExpenses: 0,
      incomeBasis: 1_000,
      averageRevenuePerSession: 100,
    });

    expect(result.breakEvenRevenue).toBe(100.01);
    expect(result.breakEvenSessions).toBe(2);
  });
});

describe("monthly and annual budgeting", () => {
  const months: BudgetMonthInput[] = [
    {
      month: "2026-02",
      plannedIncome: 900,
      plannedFixedExpenses: 160,
      plannedVariableExpenses: 450,
      projectedIncome: 800,
      projectedExpenses: 700,
      forecastSessions: 16,
      earnedIncome: 700,
      cashCollected: 720,
      actualExpenses: 500,
      targetSessions: 30,
      billableSessions: 28,
    },
    {
      month: "2026-01",
      plannedIncome: 100,
      plannedFixedExpenses: 40,
      plannedVariableExpenses: 10,
      projectedIncome: 120,
      projectedExpenses: 70,
      forecastSessions: 12,
      earnedIncome: 50,
      cashCollected: 40,
      actualExpenses: 30,
      targetSessions: 10,
      billableSessions: 5,
    },
  ];

  it("sorts month rows and sums all source figures", () => {
    const report = buildBudgetReport(months);

    expect(report.months.map((row) => row.month)).toEqual(["2026-01", "2026-02"]);
    expect(report.annual).toMatchObject({
      plannedIncome: 1_000,
      plannedFixedExpenses: 200,
      plannedVariableExpenses: 460,
      plannedExpenses: 660,
      plannedSurplus: 340,
      projectedIncome: 920,
      projectedExpenses: 770,
      projectedSurplus: 150,
      forecastSessions: 28,
      earnedIncome: 750,
      cashCollected: 760,
      actualExpenses: 530,
      actualSurplus: 220,
      targetSessions: 40,
      billableSessions: 33,
      collectionGap: -10,
    });
  });

  it("recomputes annual ratios from weighted totals instead of averaging months", () => {
    const report = buildBudgetReport(months);

    // Monthly variable-cost ratios are 10% and 50%. Their simple average is
    // 30%, but the true revenue-weighted annual ratio is 460 / 1,000 = 46%.
    expect(report.months.map((row) => row.breakEven.variableCostRatio)).toEqual([
      0.1,
      0.5,
    ]);
    expect(report.annual.breakEven).toMatchObject({
      variableCostRatio: 0.46,
      contributionMarginRatio: 0.54,
      averageRevenuePerSession: 32.86,
      variableExpensePerSession: 15.11,
      contributionMarginPerSession: 17.74,
      breakEvenRevenue: 370.37,
      breakEvenSessions: 12,
      additionalRevenueNeeded: 0,
      additionalSessionsNeeded: 0,
    });
  });

  it("returns a complete zero summary for an empty plan", () => {
    const report = buildBudgetReport([]);

    expect(report.months).toEqual([]);
    expect(report.annual.plannedIncome).toBe(0);
    expect(report.annual.actualExpenses).toBe(0);
    expect(report.annual.breakEven.breakEvenRevenue).toBeNull();
  });
});
