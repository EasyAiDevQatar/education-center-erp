import { Prisma } from "@prisma/client";

export type DecimalLike = Prisma.Decimal | number | string | null | undefined;

/** Convert a Prisma Decimal (or number/string) to a JS number safely. */
export function toNumber(v: DecimalLike): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  return v.toNumber();
}

/**
 * Format a monetary amount for display. Uses Western digits by default (matching
 * the source spreadsheet). Currency label is passed separately so it can be
 * localized via i18n.
 */
export function formatMoney(v: DecimalLike, opts?: { decimals?: number }): string {
  const n = toNumber(v);
  return n.toLocaleString("en-US", {
    minimumFractionDigits: opts?.decimals ?? 0,
    maximumFractionDigits: opts?.decimals ?? 2,
  });
}

/** Format hours (allows .5 increments as seen in the source data). */
export function formatHours(v: DecimalLike): string {
  const n = toNumber(v);
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatDate(d: Date | string, locale = "en"): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
