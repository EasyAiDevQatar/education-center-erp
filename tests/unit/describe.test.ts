import { describe, it, expect } from "vitest";
import {
  describeLogic,
  logicWarnings,
  RECOMMENDED,
  type LogicInput,
} from "@/lib/transport/describe";

/** A configuration built from the recommended values — the sane baseline. */
const sane: LogicInput = {
  driverModel: "DROP_AND_RETURN",
  includeTeacher: true,
  includeStudentToCenter: true,
  includeStudentToHome: true,
  maxDeadheadKm: 25,
  allowInvalidOverride: false,
  ...RECOMMENDED,
};

/** The configuration actually found stored in production: zeros everywhere. */
const crazy: LogicInput = {
  ...sane,
  avgSpeedKmh: 70,
  includeStudentToCenter: false,
  includeStudentToHome: false,
  preferredArrivalBufferMin: 0,
  minArrivalBufferMin: 0,
  maxEarlyArrivalMin: 0,
  dismissalBufferMin: 0,
  boardingTimeMin: 0,
  dropoffTimeMin: 0,
  maxJourneyMin: 0,
  minDriverTurnaroundMin: 0,
  minVehicleTurnaroundMin: 0,
};

const keys = (c: LogicInput) => logicWarnings(c).map((w) => w.key);

describe("describeLogic", () => {
  it("describes every rule group", () => {
    const out = describeLogic(sane).map((l) => l.key);
    expect(out).toContain("who");
    expect(out).toContain("modelDropAndReturn");
    expect(out).toContain("advance");
    expect(out).toContain("travel");
    expect(out).toContain("arrive");
    expect(out).toContain("approveStrict");
  });

  it("names the driver model actually in force", () => {
    expect(describeLogic({ ...sane, driverModel: "STAY" }).map((l) => l.key)).toContain(
      "modelStay",
    );
  });

  it("says so when nobody is carried at all", () => {
    const none = {
      ...sane,
      includeTeacher: false,
      includeStudentToCenter: false,
      includeStudentToHome: false,
    };
    expect(describeLogic(none).map((l) => l.key)).toContain("whoNobody");
  });

  it("carries the real numbers through as params", () => {
    const travel = describeLogic(sane).find((l) => l.key === "travel");
    expect(travel?.params).toMatchObject({ speed: 40, rush: 25, detour: 1.35 });
  });
});

describe("logicWarnings", () => {
  it("stays quiet on a sane configuration", () => {
    expect(logicWarnings(sane)).toEqual([]);
  });

  it("flags every defect in the configuration found in production", () => {
    expect(keys(crazy)).toEqual(
      expect.arrayContaining([
        "warnNoStudents",
        "warnSpeed",
        "warnNoArrivalBuffer",
        "warnNoEarlyAllowance",
        "warnNoService",
        "warnNoTurnaround",
        "warnNoJourneyCap",
      ]),
    );
  });

  it("treats motorway speed as implausible for city driving", () => {
    expect(keys({ ...sane, avgSpeedKmh: 60 })).toContain("warnSpeed");
    expect(keys({ ...sane, avgSpeedKmh: 59 })).not.toContain("warnSpeed");
  });

  it("reports nobody-carried rather than no-students when all are off", () => {
    const none = {
      ...sane,
      includeTeacher: false,
      includeStudentToCenter: false,
      includeStudentToHome: false,
    };
    expect(keys(none)).toContain("warnNobody");
    expect(keys(none)).not.toContain("warnNoStudents");
  });

  it("warns while invalid trips may be force-approved", () => {
    expect(keys({ ...sane, allowInvalidOverride: true })).toContain("warnOverrideOn");
  });

  it("points at the field to correct", () => {
    const w = logicWarnings(crazy).find((x) => x.key === "warnSpeed");
    expect(w?.field).toBe("avgSpeedKmh");
  });
});
