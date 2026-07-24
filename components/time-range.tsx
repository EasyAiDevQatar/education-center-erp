import { minToHHMM } from "@/lib/planner";

/**
 * A start–end time range that reads naturally in the ambient direction.
 *
 * In Arabic (RTL) the earlier time sits on the RIGHT (where reading begins),
 * with the later time to its left — while each clock time keeps its own
 * left-to-right digits (no "30:15"). In LTR it reads start→end as usual. Just
 * inherit the surrounding `dir`; never force `ltr` on the whole range.
 */
export function TimeRange({
  start,
  end,
  className,
}: {
  start: number;
  end: number;
  className?: string;
}) {
  return (
    <span className={`tabular-nums${className ? " " + className : ""}`}>
      <bdi dir="ltr">{minToHHMM(start)}</bdi>
      <span className="mx-0.5">–</span>
      <bdi dir="ltr">{minToHHMM(end)}</bdi>
    </span>
  );
}
