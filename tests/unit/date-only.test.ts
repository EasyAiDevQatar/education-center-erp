import { describe, expect, it } from "vitest";
import { formatDateOnly, formatDateTime, parseDateOnlyInput } from "@/lib/date-only";

describe("date-only formatting", () => {
  it("renders ISO date-only values as exact Western-digit DD/MM/YYYY", () => {
    expect(formatDateOnly("2026-09-10")).toBe("10/09/2026");
    expect(formatDateOnly("2026-09-10T23:59:59.999Z")).toBe("10/09/2026");
    expect(formatDateOnly("2026-09-10T00:30:00+14:00")).toBe("10/09/2026");
    expect(formatDateOnly(new Date("2024-02-29T00:00:00.000Z"))).toBe("29/02/2024");
  });

  it("renders Date instants on the centre's Qatar calendar day", () => {
    expect(formatDateOnly(new Date("2026-09-10T21:30:00.000Z"))).toBe("11/09/2026");
  });

  it("uses UTC calendar fields for Date objects instead of the machine timezone", () => {
    expect(formatDateOnly(new Date("2026-09-09T23:30:00-03:00"))).toBe("10/09/2026");
  });

  it("returns direction-neutral day-first text for use inside Arabic RTL layouts", () => {
    const result = formatDateOnly("2026-10-09");

    expect(result).toBe("09/10/2026");
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(result).not.toMatch(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/);
  });

  it("does not roll impossible dates into another month", () => {
    expect(formatDateOnly("2025-02-29")).toBe("—");
    expect(formatDateOnly("2026-04-31")).toBe("—");
    expect(formatDateOnly("2026-00-10")).toBe("—");
    expect(formatDateOnly("2026-09-10garbage")).toBe("—");
    expect(formatDateOnly("not-a-date")).toBe("—");
    expect(formatDateOnly(new Date(Number.NaN))).toBe("—");
  });

  it("uses the empty display fallback for missing values", () => {
    expect(formatDateOnly(null)).toBe("—");
    expect(formatDateOnly(undefined)).toBe("—");
    expect(formatDateOnly("")).toBe("—");
  });
});

describe("DD/MM/YYYY date input parsing", () => {
  it("converts a valid day-first value to its ISO form value", () => {
    expect(parseDateOnlyInput("10/09/2026")).toBe("2026-09-10");
    expect(parseDateOnlyInput(" 10/09/2026 ")).toBe("2026-09-10");
  });

  it("accepts Arabic and Persian numerals but keeps the stored value Western ISO", () => {
    expect(parseDateOnlyInput("١٠/٠٩/٢٠٢٦")).toBe("2026-09-10");
    expect(parseDateOnlyInput("۱۰/۰۹/۲۰۲۶")).toBe("2026-09-10");
    expect(parseDateOnlyInput("١٠‏/٠٩‏/٢٠٢٦")).toBe("2026-09-10");
  });

  it("handles leap years without normalizing invalid calendar dates", () => {
    expect(parseDateOnlyInput("29/02/2024")).toBe("2024-02-29");
    expect(parseDateOnlyInput("29/02/2025")).toBeNull();
    expect(parseDateOnlyInput("29/02/2000")).toBe("2000-02-29");
    expect(parseDateOnlyInput("29/02/1900")).toBeNull();
    expect(parseDateOnlyInput("31/04/2026")).toBeNull();
  });

  it.each([
    "",
    "00/09/2026",
    "10/00/2026",
    "32/01/2026",
    "10/13/2026",
    "9/10/2026",
    "09/10/26",
    "09/10/0000",
    "2026-10-09",
    "09-10-2026",
    "text",
  ])("rejects invalid or non-DD/MM/YYYY input: %j", (value) => {
    expect(parseDateOnlyInput(value)).toBeNull();
  });

  it("round-trips every valid display value without changing its calendar day", () => {
    for (const iso of ["2024-02-29", "2026-01-01", "2026-09-10", "2099-12-31"]) {
      expect(parseDateOnlyInput(formatDateOnly(iso))).toBe(iso);
    }
  });
});

describe("date-time formatting", () => {
  it("renders real instants in Qatar with an exact day-first date", () => {
    expect(formatDateTime("2026-09-10T21:30:00.000Z")).toBe("11/09/2026 00:30");
  });

  it("uses Western digits without bidirectional control characters", () => {
    const result = formatDateTime(new Date("2026-10-09T07:05:00.000Z"));
    expect(result).toBe("09/10/2026 10:05");
    expect(result).not.toMatch(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/);
  });
});
