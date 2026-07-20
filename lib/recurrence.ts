/** Weekly recurrence expansion for group bookings.
 *
 * Given a start date (YYYY-MM-DD), a set of weekdays (JS day numbers, 0 = Sunday
 * … 6 = Saturday), and a number of weeks, returns the concrete occurrence dates
 * (YYYY-MM-DD, sorted, de-duplicated). For each selected weekday it emits the
 * first occurrence on/after the start date, then one per week for `weeks` weeks.
 * If no weekdays are given, the start date's own weekday is used. All arithmetic
 * is done in UTC to match how session start times are stored (wall-clock UTC).
 */
export function weeklyOccurrences(
  startYmd: string,
  weekdays: number[],
  weeks: number,
): string[] {
  const start = new Date(`${startYmd}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return [];
  const startDOW = start.getUTCDay();
  const days = weekdays.length ? weekdays : [startDOW];
  const n = Math.max(1, Math.min(52, Math.floor(weeks) || 1));

  const out = new Set<string>();
  for (const dn of days) {
    if (dn < 0 || dn > 6) continue;
    const first = new Date(start);
    first.setUTCDate(first.getUTCDate() + ((dn - startDOW + 7) % 7)); // first on/after start
    for (let w = 0; w < n; w++) {
      const dt = new Date(first);
      dt.setUTCDate(dt.getUTCDate() + w * 7);
      out.add(dt.toISOString().slice(0, 10));
    }
  }
  return [...out].sort();
}
