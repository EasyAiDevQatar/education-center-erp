const pad = (n: number) => String(n).padStart(2, "0");

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
