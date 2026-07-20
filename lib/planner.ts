/** Pure time-placement logic for the daily planner (no DB access — unit tested).
 *
 * All times are minutes from midnight in the wall-clock convention used across
 * the app (session `date` stores wall-clock time as UTC).
 */

/** Working window the planner keeps suggestions inside. */
export const PLANNER_MIN = 7 * 60; // 07:00
export const PLANNER_MAX = 23 * 60; // 23:00

export type PlannedSlot = {
  startMin: number;
  /** Duration in hours (0.5 steps allowed). */
  hours: number;
};

export type DraftSlot = PlannedSlot & {
  id: string;
  location: string; // CENTER | HOME
};

function clamp(min: number): number {
  return Math.max(PLANNER_MIN, Math.min(min, PLANNER_MAX));
}

/**
 * Suggest the start time for the next session in a teacher's day:
 * the end of their latest existing session (any status), else the centre's
 * planner day-start; HOME visits get a travel gap in front.
 */
export function suggestNextStart({
  existing,
  dayStartMin,
  homeGapMin,
  nextLocation,
}: {
  existing: PlannedSlot[];
  dayStartMin: number;
  homeGapMin: number;
  nextLocation: string;
}): number {
  let start: number;
  if (existing.length === 0) {
    start = dayStartMin;
  } else {
    start = Math.max(...existing.map((s) => s.startMin + s.hours * 60));
    if (nextLocation === "HOME") start += homeGapMin;
  }
  // Snap to 5-minute grid for tidy times.
  start = Math.round(start / 5) * 5;
  return clamp(start);
}

/**
 * Re-chain a teacher's DRAFT sessions to remove gaps ("رصّ الأوقات").
 *
 * Drafts keep their current order (by start time). Confirmed/other sessions are
 * immovable anchors: each draft starts at the later of (previous chained end,
 * latest fixed end that begins at or before it would start). The first draft
 * anchors to `anchorMin` when there are no earlier fixed sessions. HOME drafts
 * get the travel gap inserted before them.
 */
export function compactTimes({
  drafts,
  fixed,
  anchorMin,
  homeGapMin,
}: {
  drafts: DraftSlot[];
  fixed: PlannedSlot[];
  anchorMin: number;
  homeGapMin: number;
}): { id: string; startMin: number }[] {
  const ordered = [...drafts].sort((a, b) => a.startMin - b.startMin);
  const fixedSorted = [...fixed].sort((a, b) => a.startMin - b.startMin);

  let cursor = anchorMin;
  const out: { id: string; startMin: number }[] = [];

  for (const d of ordered) {
    let start = cursor;
    if (d.location === "HOME") start += homeGapMin;

    // Push past any fixed session overlapping the candidate window.
    let moved = true;
    while (moved) {
      moved = false;
      for (const f of fixedSorted) {
        const fEnd = f.startMin + f.hours * 60;
        const dEnd = start + d.hours * 60;
        if (start < fEnd && dEnd > f.startMin) {
          start = d.location === "HOME" ? fEnd + homeGapMin : fEnd;
          moved = true;
        }
      }
    }

    start = clamp(Math.round(start / 5) * 5);
    out.push({ id: d.id, startMin: start });
    cursor = start + d.hours * 60;
  }
  return out;
}

/** "HH:mm" → minutes from midnight (NaN-safe, defaults to 14:00). */
export function hhmmToMin(v: string | null | undefined, fallback = 14 * 60): number {
  if (!v || !/^\d{1,2}:\d{2}$/.test(v)) return fallback;
  const [h, m] = v.split(":").map(Number);
  const total = h * 60 + m;
  return Number.isFinite(total) ? total : fallback;
}

/** Minutes from midnight → "HH:mm". */
export function minToHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
