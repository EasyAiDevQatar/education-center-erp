"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { minToHHMM } from "@/lib/planner";
import type { Conflict } from "@/lib/conflicts";
import { checkConflicts, type ConflictResult } from "@/app/[locale]/(app)/sessions/conflict-actions";

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
