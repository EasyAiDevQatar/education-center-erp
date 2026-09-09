/**
 * Date-only values are calendar days, not instants in a timezone.
 *
 * The database and form value stays ISO (`YYYY-MM-DD`), while every person sees
 * an unambiguous Western-digit `DD/MM/YYYY`. Keeping this module pure makes the
 * conversion usable by server and client components without locale-dependent
 * `Intl` output or the UTC-day shifts caused by reparsing a date-only string.
 */

const EMPTY_DATE = "—";

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return Number.isInteger(day) && day >= 1 && day <= days[month - 1];
}

function partsToDisplay(year: number, month: number, day: number): string {
  if (!isCalendarDate(year, month, day)) return EMPTY_DATE;
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${String(year).padStart(4, "0")}`;
}

/** Exact, locale-independent `DD/MM/YYYY`, suitable for a `dir="ltr"` wrapper. */
export function formatDateOnly(value: Date | string | null | undefined): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return EMPTY_DATE;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Qatar",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
    return partsToDisplay(part("year"), part("month"), part("day"));
  }

  if (typeof value !== "string" || !value) return EMPTY_DATE;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(value);
  if (!match) return EMPTY_DATE;
  return partsToDisplay(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** Exact Qatar-local `DD/MM/YYYY HH:mm` for real instants such as audit logs. */
export function formatDateTime(value: Date | string | null | undefined): string {
  const date = value instanceof Date ? value : typeof value === "string" && value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return EMPTY_DATE;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Qatar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
}

function westernDigits(value: string): string {
  return value
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gi, "")
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => {
      const code = digit.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    });
}

/** Parse strict `DD/MM/YYYY` display input into the ISO value used by forms. */
export function parseDateOnlyInput(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(westernDigits(value.trim()));
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!isCalendarDate(year, month, day)) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}
