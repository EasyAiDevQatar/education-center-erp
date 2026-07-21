/**
 * Print the current page at a given paper size.
 *
 * `@page { size: … }` only works at the top level of a stylesheet — it cannot
 * be scoped by a class, and named pages (`page: foo`) are not honoured by the
 * browsers this runs on. So the rule is injected for the duration of the print
 * call and removed afterwards.
 *
 * Used by the planner (landscape, to fit the teacher × slot grid), the
 * timetables, and the calendar list view (portrait).
 */
export type PageSize = "A4 portrait" | "A4 landscape";

export type PrintOptions = {
  size?: PageSize;
  /** Page margin in mm. A single number, or per-side for a footer's clearance. */
  margin?: number | { top: number; side: number; bottom: number };
  /**
   * Proposed filename for "Save as PDF".
   *
   * Browsers offer no filename API — they derive it from `document.title`, so
   * the title is swapped for the duration of the call. Without this the app's
   * own title leaks into the file name, giving every saved PDF the same
   * unhelpful "مركز تعليمي — نظام الإدارة" name.
   */
  fileName?: string;
};

export function printDoc(
  sizeOrOptions: PageSize | PrintOptions = "A4 portrait",
  legacyMarginMm = 8,
) {
  const opts: PrintOptions =
    typeof sizeOrOptions === "string"
      ? { size: sizeOrOptions, margin: legacyMarginMm }
      : sizeOrOptions;

  const size = opts.size ?? "A4 portrait";
  const m = opts.margin ?? 8;
  const margin =
    typeof m === "number" ? `${m}mm` : `${m.top}mm ${m.side}mm ${m.bottom}mm`;

  const style = document.createElement("style");
  style.media = "print";
  style.textContent = `@page { size: ${size}; margin: ${margin}; }`;
  document.head.appendChild(style);

  const originalTitle = document.title;
  if (opts.fileName) document.title = opts.fileName;

  try {
    window.print();
  } finally {
    style.remove();
    document.title = originalTitle;
  }
}
