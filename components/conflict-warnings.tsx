"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { minToHHMM } from "@/lib/planner";
import type { Conflict } from "@/lib/conflicts";
import {
  checkConflicts,
  checkSpacing,
  type ConflictResult,
  type SpacingCheck,
} from "@/app/[locale]/(app)/sessions/conflict-actions";

/** Render one conflict as a sentence, falling back when we have no name. */
function useConflictText() {
  const t = useTranslations("conflicts");
  return (c: Conflict) => {
    const when =
      c.startMin !== undefined && c.hours !== undefined
        ? ` (${minToHHMM(c.startMin)}–${minToHHMM(c.startMin + c.hours * 60)})`
        : "";
    if (c.kind === "TEACHER_BUSY")
      return (c.withName ? t("teacherBusy", { name: c.withName }) : t("teacherBusyPlain")) + when;
    if (c.kind === "STUDENT_BUSY")
      return (c.withName ? t("studentBusy", { name: c.withName }) : t("studentBusyPlain")) + when;
    return t("outsideAvailability");
  };
}

/** Amber advisory panel. Renders nothing when the slot is clean. */
export function ConflictWarnings({ conflicts }: { conflicts: Conflict[] }) {
  const t = useTranslations("conflicts");
  const text = useConflictText();
  if (conflicts.length === 0) return null;

  return (
    <div className="rounded-md border border-warning bg-warning/10 p-2.5 text-sm">
      <div className="mb-1 flex items-center gap-1.5 font-medium">
        <AlertTriangle className="size-4 shrink-0" />
        {t("title")}
      </div>
      <ul className="ms-5 list-disc space-y-0.5">
        {conflicts.map((c, i) => (
          <li key={i}>{text(c)}</li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-muted-foreground">{t("advisory")}</p>
    </div>
  );
}

type Query = {
  date: string;
  time: string;
  hours: number;
  teacherId: string;
  studentIds: string[];
  excludeId?: string | null;
};

/**
 * Debounced conflict lookup for a candidate slot.
 *
 * Returns per-student results so the group-booking dialog can show a count
 * while the single-session dialog just reads the first entry. Incomplete
 * queries (no teacher/student yet) resolve to an empty list without a
 * round-trip, and stale responses are discarded.
 */
export function useConflictCheck(query: Query | null, enabled = true): ConflictResult[] {
  const [results, setResults] = useState<ConflictResult[]>([]);

  const key = query
    ? [query.date, query.time, query.hours, query.teacherId, query.excludeId ?? "", ...query.studentIds].join("|")
    : "";

  useEffect(() => {
    if (!enabled || !query || !query.teacherId || query.studentIds.length === 0) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const res = await checkConflicts(query);
      if (!cancelled) setResults(res);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // `key` collapses the query into a stable dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return results;
}

/* -------- Transport spacing ---------------------------------------------- */

type SpacingQuery = {
  date: string;
  time: string;
  hours: number;
  teacherId: string;
  /** Whose home, so the rule can measure instead of assuming. */
  studentId?: string;
  location: "CENTER" | "HOME";
  excludeId?: string | null;
};

/**
 * Debounced spacing lookup — is there room for the journeys this lesson needs?
 *
 * Separate from useConflictCheck because it asks a separate question and can
 * answer for a booking with no student chosen yet: the room a teacher needs
 * between two of her own lessons does not depend on who is in them.
 */
export function useSpacingCheck(query: SpacingQuery | null, enabled = true): SpacingCheck | null {
  const [result, setResult] = useState<SpacingCheck | null>(null);

  const key = query
    ? [query.date, query.time, query.hours, query.teacherId, query.location, query.excludeId ?? ""].join("|")
    : "";

  useEffect(() => {
    // Every setState happens inside the timeout, never synchronously in the
    // effect body — the latter cascades a render on each keystroke.
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (!enabled || !query || !query.teacherId) {
        if (!cancelled) setResult(null);
        return;
      }
      const res = await checkSpacing(query);
      if (!cancelled) setResult(res);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return result;
}

/**
 * Panel for a lesson that leaves no room to travel.
 *
 * Louder than the conflict panel on purpose. A double-booked teacher is a
 * scheduling preference the office may override; a home visit with no room for
 * the journey is a car that cannot exist, and every impossible trip on the
 * board traces back to one of these being saved anyway.
 */
export function SpacingWarning({
  check,
  onUseSuggestion,
}: {
  check: SpacingCheck | null;
  onUseSuggestion?: (hhmm: string) => void;
}) {
  const t = useTranslations("spacing");
  if (!check || check.problems.length === 0) return null;

  const tone = check.blocking
    ? "border-destructive bg-destructive/10"
    : "border-warning bg-warning/10";

  return (
    <div className={`rounded-md border p-2.5 text-sm ${tone}`}>
      <div className="mb-1 flex items-center gap-1.5 font-medium">
        <AlertTriangle className="size-4 shrink-0" />
        {check.blocking ? t("titleBlocking") : t("title")}
      </div>
      <ul className="ms-5 list-disc space-y-0.5">
        {check.problems.map((p, i) => (
          <li key={i}>
            {t(p.kind === "OVERLAP" ? "overlap" : "tooTight", {
              name: p.otherLabel,
              from: minToHHMM(p.otherStartMin),
              to: minToHHMM(p.otherEndMin),
              need: p.requiredGapMin,
              short: p.shortfallMin,
              // What the day actually leaves. Stating the requirement without
              // it makes the reader do the subtraction to find out how bad it
              // is — and the answer can be zero, which is worth saying plainly.
              has: Math.max(0, p.requiredGapMin - p.shortfallMin),
            })}
          </li>
        ))}
      </ul>
      {check.suggestedStartMin != null && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs">
            {t("suggestion", { time: minToHHMM(check.suggestedStartMin) })}
          </span>
          {onUseSuggestion && (
            <button
              type="button"
              className="rounded-md border border-border bg-card px-2 py-0.5 text-xs font-medium hover:bg-accent"
              onClick={() => onUseSuggestion(minToHHMM(check.suggestedStartMin!))}
            >
              {t("useSuggestion", { time: minToHHMM(check.suggestedStartMin) })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
