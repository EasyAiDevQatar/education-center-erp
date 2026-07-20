/**
 * Print the current page at a given paper size.
 *
 * `@page { size: … }` only works at the top level of a stylesheet — it cannot
 * be scoped by a class, and named pages (`page: foo`) are not honoured by the
 * browsers this runs on. So the rule is injected for the duration of the print
 * call and removed afterwards.
 *
 * Used by the planner (landscape, to fit the teacher × slot grid) and the
 * calendar list view (portrait).
 */
export type PageSize = "A4 portrait" | "A4 landscape";

export function printDoc(size: PageSize = "A4 portrait", marginMm = 8) {
  const style = document.createElement("style");
  style.media = "print";
  style.textContent = `@page { size: ${size}; margin: ${marginMm}mm; }`;
  document.head.appendChild(style);
  try {
    window.print();
  } finally {
    style.remove();
  }
}
