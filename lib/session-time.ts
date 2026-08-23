const pad = (n: number) => String(n).padStart(2, "0");
export const CENTER_TIME_ZONE = "Asia/Qatar";

/** Current centre date, independent of the deployment server's timezone. */
export function centerToday(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CENTER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** Current HH:mm at the centre, encoded as the wall-clock UTC convention used
 * by session rows. */
export function centerNowTime(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CENTER_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${value("hour")}:${value("minute")}`;
}

/** The centre's current wall clock represented with the same UTC components
 * used by Session.date. Use this when comparing "now" with scheduled rows. */
export function centerWallClockNow(d: Date = new Date()): Date {
  return combineDateTime(centerToday(d), centerNowTime(d));
}

/** Format a real timestamp (such as a door scan) in the centre's timezone.
 * Session start dates use a separate wall-clock encoding and must continue to
 * be read from their UTC components instead. */
export function centerClockTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: CENTER_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/**
 * Today as the person at the keyboard would write it.
 *
 * Deliberately NOT `new Date().toISOString().slice(0, 10)`: that is the UTC
 * day, and Qatar runs UTC+3, so between midnight and 3am it returns yesterday
 * — a receptionist booking a late class would get the wrong date.
 */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The current local time, rounded up to the next 5 minutes.
 *
 * Rounded because the planner snaps to 5-minute steps anyway, and "14:37" is
 * not a time anyone starts a lesson at; the next round slot is what they mean.
 */
export function localNowTime(): string {
  const d = new Date();
  // setMinutes past 59 rolls the hour over correctly, including across midnight.
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Combine a `YYYY-MM-DD` date and optional `HH:mm` time into a Date, treating
 *  the wall-clock components as UTC so start times are stable regardless of the
 *  server timezone (existing rows are stored at UTC midnight). */
export function combineDateTime(date: string, time?: string | null): Date {
  const t = time && /^\d{2}:\d{2}$/.test(time) ? time : "00:00";
  return new Date(`${date}T${t}:00.000Z`);
}
