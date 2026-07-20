/** Combine a `YYYY-MM-DD` date and optional `HH:mm` time into a Date, treating
 *  the wall-clock components as UTC so start times are stable regardless of the
 *  server timezone (existing rows are stored at UTC midnight). */
export function combineDateTime(date: string, time?: string | null): Date {
  const t = time && /^\d{2}:\d{2}$/.test(time) ? time : "00:00";
  return new Date(`${date}T${t}:00.000Z`);
}
