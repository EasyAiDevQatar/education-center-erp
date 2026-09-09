import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { normalizeDateInputDraft } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";

describe("shared date input", () => {
  it("shows DD/MM/YYYY but keeps the submitted value in ISO format", () => {
    const markup = renderToStaticMarkup(
      createElement(Input, {
        id: "session-date",
        name: "date",
        type: "date",
        defaultValue: "2026-09-10",
        min: "2026-01-01",
        max: "2026-12-31",
        required: true,
        className: "w-40",
      }),
    );

    expect(markup).toContain('type="text"');
    expect(markup).toContain('value="10/09/2026"');
    expect(markup).toContain('type="date"');
    expect(markup).toContain('name="date"');
    expect(markup).toContain('value="2026-09-10"');
    expect(markup).toContain('min="2026-01-01"');
    expect(markup).toContain('max="2026-12-31"');
    expect(markup).toContain("required");
    expect(markup).toContain("w-40");
    expect(markup).toContain('aria-label="Choose date"');
  });

  it("keeps the visible date day-first and left-to-right inside an Arabic layout", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "div",
        { dir: "rtl", lang: "ar" },
        createElement(Input, {
          type: "date",
          value: "2026-10-09",
          readOnly: true,
        }),
      ),
    );

    expect(markup).toContain("09/10/2026");
    expect(markup).toContain('dir="ltr"');
    expect(markup).toContain("text-left");
    expect(markup).toContain("readOnly");
  });

  it("uses an explicit day-first placeholder for an empty field", () => {
    const markup = renderToStaticMarkup(
      createElement(Input, { type: "date", name: "expiresAt" }),
    );

    expect(markup).toContain("DD/MM/YYYY");
    expect(markup).toContain('name="expiresAt"');
  });

  it("normalizes keyboard entry and pasted Arabic digits into day-first text", () => {
    expect(normalizeDateInputDraft("1")).toBe("1");
    expect(normalizeDateInputDraft("1009")).toBe("10/09");
    expect(normalizeDateInputDraft("10092026")).toBe("10/09/2026");
    expect(normalizeDateInputDraft("١٠٠٩٢٠٢٦")).toBe("10/09/2026");
    expect(normalizeDateInputDraft("2026-09-10")).toBe("10/09/2026");
    expect(normalizeDateInputDraft("1/09/2026")).toBe("1/09/2026");
    expect(normalizeDateInputDraft("12/09/2026")).toBe("12/09/2026");
    expect(normalizeDateInputDraft("10/092")).toBe("10/09/2");
    expect(normalizeDateInputDraft("10/092026")).toBe("10/09/2026");
  });

  it("keeps the visible field unnamed and submits only the ISO picker value", () => {
    const markup = renderToStaticMarkup(
      createElement(Input, { type: "date", name: "date", defaultValue: "2026-09-10" }),
    );

    expect(markup.match(/name="date"/g)).toHaveLength(1);
    expect(markup.match(/type="text"/g)).toHaveLength(1);
    expect(markup.match(/type="date"/g)).toHaveLength(1);
  });

  it("leaves non-date inputs on the normal input path", () => {
    const markup = renderToStaticMarkup(
      createElement(Input, { type: "text", name: "student", defaultValue: "Ali" }),
    );

    expect(markup).toContain('type="text"');
    expect(markup).toContain('value="Ali"');
    expect(markup).not.toContain("DD/MM/YYYY");
  });
});
