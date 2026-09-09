import { centerToday } from "./session-time";

function validDay(value?: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : "";
}

function shiftDay(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Validates direct URL dates and supplies a readable 30-day daily-report range. */
export function resolveReportDateStrings(input: {
  report: string;
  from?: string | null;
  to?: string | null;
  termFrom?: string | null;
  termTo?: string | null;
  today?: string;
}): { from: string; to: string } {
  const hasTerm = Boolean(input.termFrom && input.termTo);
  let from = validDay(hasTerm ? input.termFrom : input.from);
  let to = validDay(hasTerm ? input.termTo : input.to);

  if (!hasTerm && input.report === "daily-sessions") {
    const today = validDay(input.today) || centerToday();
    if (!from && !to) {
      to = today;
      from = shiftDay(to, -29);
    } else if (!from) {
      from = shiftDay(to, -29);
    } else if (!to) {
      to = today;
    }
  }

  if (from && to && from > to) [from, to] = [to, from];
  return { from, to };
}
