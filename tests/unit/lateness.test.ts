import { describe, it, expect } from "vitest";
import {
  classifyLateness,
  resolveSessionPolicy,
  savingIsMeaningful,
  DEFAULT_LATENESS_CONFIG,
  NO_SAVING,
  type LatenessConfig,
  type OperationalSaving,
} from "@/lib/transport/lateness";

/** Controlled lateness switched on, otherwise the shipped defaults. */
const cfg: LatenessConfig = { ...DEFAULT_LATENESS_CONFIG, allowControlledLateness: true };

/** A saving comfortably over every threshold. */
const bigSaving: OperationalSaving = {
  tripsSaved: 1,
  vehiclesSaved: 1,
  emptyKmSaved: 23,
  totalKmSaved: 25,
  driverMinutesSaved: 38,
};

const policyFor = (over: Parameters<typeof resolveSessionPolicy>[0], c = cfg) =>
  resolveSessionPolicy(over, c);

const classify = (
  latenessMin: number,
  over: Parameters<typeof resolveSessionPolicy>[0],
  saving: OperationalSaving = bigSaving,
  c = cfg,
) => classifyLateness({ latenessMin, policy: policyFor(over, c), config: c, saving });

describe("resolveSessionPolicy", () => {
  it("keeps exams and assessments strict whatever the session asks for", () => {
    for (const t of ["EXAM", "ASSESSMENT"] as const) {
      const p = policyFor({ sessionType: t, transportTimingPolicy: "VERY_FLEXIBLE", maxAllowedLatenessMin: 30 });
      expect(p.policy).toBe("STRICT");
      expect(p.maxLatenessMin).toBe(0);
      expect(p.forcedByType).toBe(true);
    }
  });

  it("lets a session-specific limit override the global one", () => {
    const p = policyFor({ sessionType: "REGULAR", maxAllowedLatenessMin: 25 });
    expect(p.maxLatenessMin).toBe(25); // not the 10-minute centre default
  });

  it("never lets a session exceed the platform maximum", () => {
    const p = policyFor({ sessionType: "REGULAR", maxAllowedLatenessMin: 90 });
    expect(p.maxLatenessMin).toBe(30);
  });

  it("allows nothing while controlled lateness is switched off", () => {
    const p = policyFor({ sessionType: "REGULAR", maxAllowedLatenessMin: 20 }, DEFAULT_LATENESS_CONFIG);
    expect(p.maxLatenessMin).toBe(0);
  });
});

describe("classifyLateness — policy limits", () => {
  it("a strict session rejects even one minute", () => {
    const d = classify(1, { sessionType: "REGULAR", transportTimingPolicy: "STRICT" });
    expect(d.outcome).toBe("INVALID");
    expect(d.reason).toBe("policyStrict");
  });

  it("an exam rejects one minute of lateness", () => {
    const d = classify(1, { sessionType: "EXAM" });
    expect(d.outcome).toBe("INVALID");
  });

  it("a flexible session accepts lateness inside its limit", () => {
    const d = classify(8, { sessionType: "REGULAR", maxAllowedLatenessMin: 20 });
    expect(d.outcome).toBe("DELAYED_EXCEPTION");
  });

  it("accepts up to 10 minutes without a human when the policy allows it", () => {
    const d = classify(10, {
      sessionType: "REGULAR",
      transportTimingPolicy: "VERY_FLEXIBLE",
      maxAllowedLatenessMin: 30,
      requireDelayApproval: false,
    });
    expect(d.outcome).toBe("DELAYED_EXCEPTION");
    expect(d.requiresApproval).toBe(false);
  });

  it("needs approval between 11 and 30 minutes", () => {
    for (const m of [11, 20, 30]) {
      const d = classify(m, {
        sessionType: "REGULAR",
        transportTimingPolicy: "VERY_FLEXIBLE",
        maxAllowedLatenessMin: 30,
        requireDelayApproval: false,
      });
      expect(d.outcome).toBe("DELAYED_EXCEPTION");
      expect(d.requiresApproval).toBe(true);
    }
  });

  it("is INVALID beyond the absolute maximum", () => {
    const d = classify(31, {
      sessionType: "REGULAR",
      transportTimingPolicy: "VERY_FLEXIBLE",
      maxAllowedLatenessMin: 30,
    });
    expect(d.outcome).toBe("INVALID");
    expect(d.reason).toBe("exceedsPolicy");
  });

  it("is VALID, not delayed, when it arrives on time", () => {
    const d = classify(0, { sessionType: "REGULAR" });
    expect(d.outcome).toBe("VALID");
    expect(d.reason).toBe("onTime");
  });
});

describe("classifyLateness — the saving must justify it", () => {
  it("rejects a permitted delay that saves nothing", () => {
    const d = classify(8, { sessionType: "REGULAR", maxAllowedLatenessMin: 20 }, NO_SAVING);
    expect(d.outcome).toBe("INVALID");
    expect(d.reason).toBe("savingTooSmall");
  });

  it("rejects a delay whose saving is below every threshold", () => {
    const tiny: OperationalSaving = {
      tripsSaved: 0,
      vehiclesSaved: 0,
      emptyKmSaved: 2,
      totalKmSaved: 3,
      driverMinutesSaved: 4,
    };
    expect(classify(8, { sessionType: "REGULAR", maxAllowedLatenessMin: 20 }, tiny).outcome).toBe(
      "INVALID",
    );
  });

  it("accepts when a whole trip is saved even with no empty-km gain", () => {
    const oneTrip: OperationalSaving = { ...NO_SAVING, tripsSaved: 1 };
    expect(classify(8, { sessionType: "REGULAR", maxAllowedLatenessMin: 20 }, oneTrip).outcome).toBe(
      "DELAYED_EXCEPTION",
    );
  });

  it("savingIsMeaningful needs only one measure to clear its threshold", () => {
    expect(savingIsMeaningful({ ...NO_SAVING, driverMinutesSaved: 30 }, cfg)).toBe(true);
    expect(savingIsMeaningful({ ...NO_SAVING, driverMinutesSaved: 29 }, cfg)).toBe(false);
  });
});

describe("classifyLateness — impossibility is never an exception", () => {
  it("keeps a physically impossible trip INVALID however generous the policy", () => {
    const d = classifyLateness({
      latenessMin: 5,
      policy: policyFor({
        sessionType: "REGULAR",
        transportTimingPolicy: "VERY_FLEXIBLE",
        maxAllowedLatenessMin: 30,
      }),
      config: cfg,
      saving: bigSaving,
      physicallyInfeasible: true,
    });
    expect(d.outcome).toBe("INVALID");
    expect(d.reason).toBe("physicallyImpossible");
  });

  it("refuses any lateness while the feature is switched off", () => {
    const d = classify(5, { sessionType: "REGULAR", maxAllowedLatenessMin: 20 }, bigSaving, {
      ...cfg,
      allowControlledLateness: false,
    });
    expect(d.outcome).toBe("INVALID");
  });
});
