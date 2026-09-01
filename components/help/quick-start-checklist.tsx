"use client";

import { useMemo, useState } from "react";
import { Check, Circle, ExternalLink, RotateCcw } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type QuickStartItem = {
  id: string;
  title: string;
  description: string;
  href: string;
  action: string;
};

export function QuickStartChecklist({
  items,
  labels,
}: {
  items: QuickStartItem[];
  labels: {
    title: string;
    progress: string;
    complete: string;
    completed: string;
    reset: string;
  };
}) {
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const completed = done.size;
  const percent = useMemo(
    () => (items.length ? Math.round((completed / items.length) * 100) : 0),
    [completed, items.length],
  );

  function toggle(id: string) {
    setDone((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section aria-labelledby="quick-start-checklist-title" className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-primary/[0.04] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="quick-start-checklist-title" className="text-xl font-bold">{labels.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {completed} {labels.progress} {items.length}
            </p>
          </div>
          {completed > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setDone(new Set())}>
              <RotateCcw />
              {labels.reset}
            </Button>
          )}
        </div>
        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={items.length}
          aria-valuenow={completed}
          aria-label={labels.title}
        >
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <ol className="divide-y divide-border">
        {items.map((item, index) => {
          const checked = done.has(item.id);
          return (
            <li key={item.id} className={cn("p-4 transition-colors sm:p-5", checked && "bg-emerald-50/60 dark:bg-emerald-950/20")}>
              <div className="flex items-start gap-3 sm:gap-4">
                <button
                  type="button"
                  onClick={() => toggle(item.id)}
                  aria-pressed={checked}
                  aria-label={`${checked ? labels.completed : labels.complete}: ${item.title}`}
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    checked
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-border bg-card text-muted-foreground hover:border-primary hover:text-primary",
                  )}
                >
                  {checked ? <Check className="size-4" /> : <Circle className="size-3" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold text-primary">{index + 1}</p>
                      <h3 className={cn("mt-0.5 font-semibold", checked && "text-muted-foreground line-through")}>{item.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.description}</p>
                    </div>
                    <Button asChild variant="outline" size="sm" className="shrink-0 self-start">
                      <Link href={item.href} target="_blank" rel="noreferrer">
                        {item.action}
                        <ExternalLink className="size-3.5" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
