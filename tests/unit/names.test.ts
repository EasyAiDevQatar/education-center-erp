import { describe, it, expect } from "vitest";
import { displayName, fullName, nameSearchText } from "../../lib/names";

const both = { name: "محمد قرني", nameEn: "Mohamed Qarni" };
const arOnly = { name: "نجلاء", nameEn: null };
const blank = { name: "رحاب", nameEn: "   " };

describe("displayName", () => {
  it("shows the Arabic name in Arabic", () => {
    expect(displayName(both, "ar")).toBe("محمد قرني");
    expect(displayName(arOnly, "ar")).toBe("نجلاء");
  });

  it("shows the English name in English", () => {
    expect(displayName(both, "en")).toBe("Mohamed Qarni");
  });

  it("falls back to the Arabic name when no English one is set", () => {
    // The records predate the field, so this is the common case — an English
    // page must never render a person as blank.
    expect(displayName(arOnly, "en")).toBe("نجلاء");
    expect(displayName(blank, "en")).toBe("رحاب");
  });

  it("ignores an unknown locale rather than guessing", () => {
    expect(displayName(both, "fr")).toBe("محمد قرني");
  });
});

describe("fullName", () => {
  it("pairs the two names so a shared first name is still distinguishable", () => {
    expect(fullName(both, "ar")).toBe("محمد قرني — Mohamed Qarni");
    expect(fullName(both, "en")).toBe("Mohamed Qarni — محمد قرني");
  });

  it("shows one name when that is all there is", () => {
    expect(fullName(arOnly, "ar")).toBe("نجلاء");
    expect(fullName(arOnly, "en")).toBe("نجلاء");
    expect(fullName(blank, "ar")).toBe("رحاب");
  });

  it("does not repeat a name that is the same in both fields", () => {
    expect(fullName({ name: "Sara", nameEn: "Sara" }, "en")).toBe("Sara");
  });
});

describe("nameSearchText", () => {
  it("matches on either spelling", () => {
    expect(nameSearchText(both)).toContain("محمد قرني");
    expect(nameSearchText(both)).toContain("Mohamed Qarni");
  });

  it("omits an empty English name rather than padding with spaces", () => {
    expect(nameSearchText(arOnly)).toBe("نجلاء");
    expect(nameSearchText(blank)).toBe("رحاب");
  });
});
