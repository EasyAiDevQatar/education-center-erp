import { describe, expect, it } from "vitest";
import {
  ageBuckets,
  buildForecastSeries,
  canTransition,
  confidenceFor,
  DEFAULT_FORECAST_SETTINGS,
  isOverdue,
  validateChequeDates,
  type ForecastCheque,
} from "@/lib/accounting/cheques";

const TODAY = new Date("2026-07-23T00:00:00.000Z");
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("canTransition", () => {
  it("allows the happy incoming path", () => {
    expect(canTransition("INCOMING", "DRAFT", "RECEIVED")).toBe(true);
    expect(canTransition("INCOMING", "RECEIVED", "DEPOSITED")).toBe(true);
    expect(canTransition("INCOMING", "DEPOSITED", "CLEARED")).toBe(true);
  });

  it("blocks skipping backwards or out of terminals", () => {
    expect(canTransition("INCOMING", "CLEARED", "BOUNCED")).toBe(false);
    expect(canTransition("INCOMING", "CANCELLED", "RECEIVED")).toBe(false);
    expect(canTransition("INCOMING", "DEPOSITED", "RECEIVED")).toBe(false);
  });

  it("bounced can only be replaced", () => {
    expect(canTransition("INCOMING", "BOUNCED", "REPLACED")).toBe(true);
    expect(canTransition("INCOMING", "BOUNCED", "DEPOSITED")).toBe(false);
  });

  it("outgoing has no pending-deposit stage", () => {
    expect(canTransition("OUTGOING", "RECEIVED", "PENDING_DEPOSIT")).toBe(false);
    expect(canTransition("OUTGOING", "RECEIVED", "CLEARED")).toBe(true);
  });
});

describe("validateChequeDates", () => {
  it("accepts the ordered flow", () => {
    expect(
      validateChequeDates({
        receivedDate: d("2026-01-01"),
        depositDate: d("2026-01-03"),
        clearanceDate: d("2026-01-06"),
      }),
    ).toBeNull();
  });

  it("rejects deposit before receipt and clearance before deposit", () => {
    expect(
      validateChequeDates({ receivedDate: d("2026-01-05"), depositDate: d("2026-01-03") }),
    ).toBe("depositBeforeReceived");
    expect(
      validateChequeDates({ depositDate: d("2026-01-05"), clearanceDate: d("2026-01-03") }),
    ).toBe("clearanceBeforeDeposit");
  });

  it("missing dates validate — statuses may not have reached them", () => {
    expect(validateChequeDates({})).toBeNull();
  });
});

describe("confidenceFor", () => {
  it("weights by stage and settings", () => {
    const s = DEFAULT_FORECAST_SETTINGS;
    expect(confidenceFor("CLEARED", s)).toBe(100);
    expect(confidenceFor("DEPOSITED", s)).toBe(95);
    expect(confidenceFor("PENDING_DEPOSIT", s)).toBe(80);
    expect(confidenceFor("RECEIVED", s)).toBe(70);
    expect(confidenceFor("BOUNCED", s)).toBe(0);
    expect(confidenceFor("DRAFT", s)).toBe(0);
  });
});

describe("isOverdue", () => {
  it("open past-due cheques are overdue; settled ones never are", () => {
    const base: ForecastCheque = {
      status: "RECEIVED",
      direction: "INCOMING",
      amount: 100,
      dueDate: d("2026-07-01"),
    };
    expect(isOverdue(base, TODAY)).toBe(true);
    expect(isOverdue({ ...base, status: "CLEARED" }, TODAY)).toBe(false);
    expect(isOverdue({ ...base, dueDate: d("2026-08-01") }, TODAY)).toBe(false);
    expect(isOverdue({ ...base, dueDate: null }, TODAY)).toBe(false);
  });
});

describe("ageBuckets", () => {
  it("buckets open incoming amounts by days past due", () => {
    const mk = (due: string, amount: number): ForecastCheque => ({
      status: "RECEIVED",
      direction: "INCOMING",
      amount,
      dueDate: d(due),
    });
    const buckets = ageBuckets(
      [
        mk("2026-08-01", 10), // future → current
        mk("2026-07-20", 20), // 3 days → d7
        mk("2026-07-01", 30), // 22 days → d30
        mk("2026-06-01", 40), // 52 days → d60
        mk("2026-01-01", 50), // way over → d60Plus
        { status: "CLEARED", direction: "INCOMING", amount: 99, dueDate: d("2026-01-01") },
        { status: "RECEIVED", direction: "OUTGOING", amount: 99, dueDate: d("2026-01-01") },
      ],
      TODAY,
    );
    expect(buckets).toEqual({ current: 10, d7: 20, d30: 30, d60: 40, d60Plus: 50 });
  });
});

describe("buildForecastSeries", () => {
  it("projects weekly gross and confidence-weighted flows", () => {
    const cheques: ForecastCheque[] = [
      { status: "DEPOSITED", direction: "INCOMING", amount: 1000, dueDate: d("2026-07-25") },
      { status: "RECEIVED", direction: "INCOMING", amount: 500, dueDate: d("2026-08-01") },
      { status: "RECEIVED", direction: "OUTGOING", amount: 200, dueDate: d("2026-07-24") },
    ];
    const series = buildForecastSeries(cheques, 3, DEFAULT_FORECAST_SETTINGS, TODAY);
    expect(series).toHaveLength(3);
    // Week 1: +1000 (deposited) − 200 (outgoing) = 800 gross;
    // weighted: 1000×0.95 − 200×0.70 = 810.
    expect(series[0].gross).toBeCloseTo(800);
    expect(series[0].weighted).toBeCloseTo(810);
    // Week 2: +500 received → weighted 350.
    expect(series[1].gross).toBeCloseTo(500);
    expect(series[1].weighted).toBeCloseTo(350);
    expect(series[2].gross).toBe(0);
  });

  it("pulls overdue open cheques into the first week", () => {
    const series = buildForecastSeries(
      [{ status: "RECEIVED", direction: "INCOMING", amount: 300, dueDate: d("2026-06-01") }],
      2,
      DEFAULT_FORECAST_SETTINGS,
      TODAY,
    );
    expect(series[0].gross).toBe(300);
    expect(series[1].gross).toBe(0);
  });

  it("excludes settled and undated cheques", () => {
    const series = buildForecastSeries(
      [
        { status: "CLEARED", direction: "INCOMING", amount: 300, dueDate: d("2026-07-25") },
        { status: "RECEIVED", direction: "INCOMING", amount: 300, dueDate: null },
      ],
      1,
      DEFAULT_FORECAST_SETTINGS,
      TODAY,
    );
    expect(series[0].gross).toBe(0);
  });
});
