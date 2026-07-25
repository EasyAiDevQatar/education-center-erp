"use client";

import { createContext, useContext, useMemo, type CSSProperties, type ReactNode, type Ref } from "react";
import { axisPct, axisTicks, type DayAxis } from "@/lib/transport/axis";
import { minToHHMM as hhmm } from "@/lib/planner";

/**
 * Minutes → HH:MM.
 *
 * Re-exported so a board never grows its own: there were three copies of those
 * four lines, and one of them would eventually have disagreed about 26:00.
 */
export { hhmm };

/**
 * The one timeline every transport board draws.
 *
 * There were two. They drew the same day differently, and each had its own
 * copy of the axis maths, its own tick clamping, its own idea of how RTL
 * works. That is not a tidiness complaint: a trip was a different width on two
 * screens showing the same trip, and the width was the thing an operator was
 * being asked to judge.
 *
 * The rules that were duplicated are now structural rather than conventional:
 *
 * - Minutes become percentages HERE and nowhere else. `place()` is the only
 *   route from a time to a position, so a board cannot invent its own.
 * - The row's DOM order is fixed at [leading, track]. A caller does not get to
 *   choose it, and therefore cannot choose it wrongly — which is exactly what
 *   happened when `flex-row-reverse` was copied between two boards whose child
 *   order was opposite, putting a driver's name at the far edge in Arabic,
 *   read last, after the bars it labels.
 * - The axis, the leading-column width and the minimum board width come from
 *   context, so a header and its rows cannot drift out of alignment.
 *
 * Presentational only. It knows nothing of trips, lessons or gaps: callers
 * render their own children into a positioned track.
 */

type TimelineCtx = {
  axis: DayAxis;
  rtl: boolean;
  /** Tailwind width class for the identity column, e.g. "w-36". */
  leadWidth: string;
  minWidthPx: number;
};

const Ctx = createContext<TimelineCtx | null>(null);

function useCtx(): TimelineCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("Timeline parts must be rendered inside <TimelineFrame>");
  return c;
}

/** Options for a positioned block. */
export type PlaceOpts = {
  /** Narrowest the block may render, in pixels. Below this it reads as a dot. */
  minWidthPx?: number;
  /** Narrowest as a percentage of the axis, before the pixel floor applies. */
  minPct?: number;
};

export type Track = ReturnType<typeof useTrack>;

/**
 * Positioning helpers for whatever a board draws inside a row.
 *
 * `S` is the physical inline-start side. Everything is positioned from it, so
 * a block lands in the same place in both directions without the caller
 * thinking about it.
 */
export function useTrack() {
  const { axis, rtl } = useCtx();
  return useMemo(() => {
    const S: "left" | "right" = rtl ? "right" : "left";
    const pct = (m: number) => axisPct(axis, m);

    /** A block spanning a period. */
    const place = (startMin: number, endMin: number, opts: PlaceOpts = {}): CSSProperties => {
      const a = pct(startMin);
      const b = pct(endMin);
      return {
        [S]: `${Math.min(a, b)}%`,
        width: `${Math.max(Math.abs(b - a), opts.minPct ?? 0.4)}%`,
        minWidth: opts.minWidthPx ?? 26,
      } as CSSProperties;
    };

    /** A point in time — a marker rather than a period. */
    const at = (minute: number): CSSProperties => ({ [S]: `${pct(minute)}%` }) as CSSProperties;

    /**
     * A grab strip on one TEMPORAL edge of a block.
     *
     * "from" is the earlier edge, whichever physical side that lands on. A
     * caller asking for "the earlier edge" cannot get RTL wrong; a caller
     * asking for "the left edge" eventually does.
     */
    const E: "left" | "right" = rtl ? "left" : "right";
    const edge = (which: "from" | "to", widthPx = 12): CSSProperties =>
      ({ [which === "from" ? S : E]: 0, width: widthPx }) as CSSProperties;

    /**
     * A pointer position inside a track → the minute it points at.
     *
     * The inverse of `place()`, and the reason a drop can land on a time: the
     * caller hands over a clientX and the track's own rectangle, and never has
     * to know which end of it the day starts from.
     */
    const minuteAt = (clientX: number, rect: DOMRect, stepMin = 15) => {
      const frac = rtl
        ? (rect.right - clientX) / Math.max(1, rect.width)
        : (clientX - rect.left) / Math.max(1, rect.width);
      const raw = axis.minMin + frac * (axis.maxMin - axis.minMin);
      const snapped = Math.round(raw / stepMin) * stepMin;
      return Math.min(axis.maxMin, Math.max(axis.minMin, snapped));
    };

    /** Percent of the axis one minute occupies — for sizing in real pixels. */
    const pctPerMin = 100 / Math.max(1, axis.maxMin - axis.minMin);

    return { S, rtl, pct, place, at, edge, minuteAt, pctPerMin, axis };
  }, [axis, rtl]);
}

/**
 * The card the timeline lives in: a heading, a horizontal scroller, a floor
 * width so nine hours are never crushed, and an optional legend below.
 */
export function TimelineFrame({
  axis,
  rtl,
  title,
  leadWidth = "w-36",
  minWidthPx = 760,
  legend,
  children,
}: {
  axis: DayAxis;
  rtl: boolean;
  title?: ReactNode;
  leadWidth?: string;
  minWidthPx?: number;
  legend?: ReactNode;
  children: ReactNode;
}) {
  const ctx = useMemo(
    () => ({ axis, rtl, leadWidth, minWidthPx }),
    [axis, rtl, leadWidth, minWidthPx],
  );
  return (
    <Ctx.Provider value={ctx}>
      {/* Scrolls sideways rather than compressing: a day squeezed into a phone
          width is unreadable, and an unreadable board is what people stop
          trusting. */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <div style={{ minWidth: minWidthPx }}>
          {title != null && (
            <p className="border-b border-border p-3 text-sm font-medium">{title}</p>
          )}
          {/* Rows get their own element so `last:border-b-0` still matches the
              final row. As siblings of the title and legend the LAST child
              would be the legend, so the bottom row kept its border and stacked
              against the legend's border-t as a doubled rule. */}
          <div>{children}</div>
          {legend != null && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border p-3 text-[11px] text-muted-foreground">
              {legend}
            </div>
          )}
        </div>
      </div>
    </Ctx.Provider>
  );
}

/** The hour ruler, aligned to the rows below it by construction. */
export function TimelineHeader({ label }: { label: ReactNode }) {
  const { axis, rtl, leadWidth } = useCtx();
  const ticks = useMemo(() => axisTicks(axis), [axis]);
  return (
    <div className="flex items-stretch gap-2 border-b border-border bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
      <div className={`${leadWidth} shrink-0 font-medium`}>{label}</div>
      <div className="relative flex-1 overflow-hidden">
        {ticks.map((m, i) => {
          // Middle labels are centred on their hour. The first and last would
          // then be half-clipped by the overflow, and both boards used to solve
          // that by shoving them 3% inward — which quietly put the edge labels
          // out of register with the blocks they name, by ~18px at the minimum
          // width and ~50px on a wide screen, since the nudge is a percentage.
          // Aligning the outer edge of the outer labels instead keeps every
          // label both fully visible and exactly over its own hour.
          const first = i === 0;
          const last = i === ticks.length - 1;
          const shift = first ? "translate-x-0" : last ? (rtl ? "translate-x-full" : "-translate-x-full") : rtl ? "translate-x-1/2" : "-translate-x-1/2";
          return (
            <span
              key={m}
              dir="ltr"
              className={`absolute tabular-nums ${shift}`}
              style={{ [rtl ? "right" : "left"]: `${axisPct(axis, m)}%` } as CSSProperties}
            >
              {hhmm(m)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One person's (or vehicle's) row: who it is, then their day.
 *
 * The order is not a prop. In Arabic the normal flex direction already puts
 * `leading` on the inline-start edge, so the name is read before the bars it
 * labels — no `flex-row-reverse` anywhere, in either direction.
 */
export function TimelineRow({
  leading,
  trackHeight = "h-10",
  trackClassName = "",
  trackRef,
  trackProps,
  baseline = true,
  children,
}: {
  leading: ReactNode;
  /** Tailwind height class for the track. */
  trackHeight?: string;
  trackClassName?: string;
  /** For boards that measure the track — dragging needs its pixel width. */
  trackRef?: Ref<HTMLDivElement>;
  /** Drop-target handlers and the like, applied to the track element. */
  trackProps?: React.HTMLAttributes<HTMLDivElement>;
  /** The hairline a day is drawn along. Off for rows with their own strands. */
  baseline?: boolean;
  /**
   * Either plain children, or a function given the positioning helpers.
   *
   * The function form exists so a board can position blocks without first
   * extracting its row into a component of its own — `useTrack` needs to run
   * inside the frame, and forcing that extraction is how a brittle file gets
   * rewritten wholesale and broken.
   */
  children?: ReactNode | ((track: Track) => ReactNode);
}) {
  const { leadWidth } = useCtx();
  const track = useTrack();
  return (
    <div className="flex items-stretch gap-2 border-b border-border px-3 py-2 last:border-b-0">
      <div className={`${leadWidth} shrink-0 flex flex-col justify-center text-xs`}>{leading}</div>
      <div
        ref={trackRef}
        {...trackProps}
        className={`relative ${trackHeight} flex-1 rounded-md bg-muted/20 ${trackClassName}`}
      >
        {baseline && <div className="absolute inset-x-0 top-1/2 h-px bg-border" />}
        {typeof children === "function" ? children(track) : children}
      </div>
    </div>
  );
}
