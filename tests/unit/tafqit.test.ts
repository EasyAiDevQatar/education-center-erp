import { describe, expect, it } from "vitest";
import { amountToArabicWords, intToArabicWords } from "@/lib/accounting/tafqit";

describe("intToArabicWords", () => {
  it("units, teens and tens", () => {
    expect(intToArabicWords(0)).toBe("صفر");
    expect(intToArabicWords(1)).toBe("واحد");
    expect(intToArabicWords(11)).toBe("أحد عشر");
    expect(intToArabicWords(20)).toBe("عشرون");
    expect(intToArabicWords(25)).toBe("خمسة وعشرون");
  });

  it("hundreds", () => {
    expect(intToArabicWords(100)).toBe("مائة");
    expect(intToArabicWords(200)).toBe("مائتان");
    expect(intToArabicWords(375)).toBe("ثلاثمائة وخمسة وسبعون");
  });

  it("thousands with Arabic number agreement", () => {
    expect(intToArabicWords(1000)).toBe("ألف");
    expect(intToArabicWords(2000)).toBe("ألفان");
    expect(intToArabicWords(3000)).toBe("ثلاثة آلاف");
    expect(intToArabicWords(11000)).toBe("أحد عشر ألف");
    expect(intToArabicWords(5250)).toBe("خمسة آلاف ومائتان وخمسون");
  });

  it("millions", () => {
    expect(intToArabicWords(1_000_000)).toBe("مليون");
    expect(intToArabicWords(2_500_000)).toBe("مليونان وخمسمائة ألف");
  });
});

describe("amountToArabicWords", () => {
  it("wraps in the cheque phrase", () => {
    expect(amountToArabicWords(5000)).toBe("فقط خمسة آلاف ريال قطري لا غير");
  });

  it("carries the subunit", () => {
    expect(amountToArabicWords(150.5)).toBe(
      "فقط مائة وخمسون ريال قطري وخمسون درهم لا غير",
    );
  });

  it("rounds float dust instead of inventing dirhams", () => {
    expect(amountToArabicWords(100.004)).toBe("فقط مائة ريال قطري لا غير");
  });

  it("zero is still a phrase, negatives are not", () => {
    expect(amountToArabicWords(0)).toBe("فقط صفر ريال قطري لا غير");
    expect(amountToArabicWords(-5)).toBe("");
  });
});
