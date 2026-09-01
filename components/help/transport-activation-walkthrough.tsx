"use client";

import { useEffect, useState } from "react";
import {
  Bus,
  Check,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Pause,
  Play,
  Save,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type WalkthroughStep = {
  title: string;
  shortTitle: string;
  description: string;
};

export function TransportActivationWalkthrough({
  steps,
  labels,
}: {
  steps: WalkthroughStep[];
  labels: {
    title: string;
    play: string;
    pause: string;
    previous: string;
    next: string;
    settings: string;
    transport: string;
    enable: string;
    centreLocation: string;
    save: string;
    active: string;
    moduleIntro: string;
  };
}) {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(
      () => setActive((current) => (current + 1) % steps.length),
      2800,
    );
    return () => window.clearInterval(timer);
  }, [playing, steps.length]);

  const previous = () => {
    setPlaying(false);
    setActive((current) => (current - 1 + steps.length) % steps.length);
  };
  const next = () => {
    setPlaying(false);
    setActive((current) => (current + 1) % steps.length);
  };

  return (
    <section aria-labelledby="walkthrough-title" className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div>
          <p id="walkthrough-title" className="font-semibold">{labels.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {active + 1} / {steps.length} · {steps[active]?.shortTitle}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={previous} aria-label={labels.previous}>
            <ChevronLeft className="rtl:rotate-180" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPlaying((value) => !value)}
            aria-label={playing ? labels.pause : labels.play}
            aria-pressed={playing}
          >
            {playing ? <Pause /> : <Play />}
            {playing ? labels.pause : labels.play}
          </Button>
          <Button variant="ghost" size="icon" onClick={next} aria-label={labels.next}>
            <ChevronRight className="rtl:rotate-180" />
          </Button>
        </div>
      </div>

      <div className="grid bg-slate-100 dark:bg-slate-950 lg:grid-cols-[190px_1fr]" dir="ltr">
        <div className="hidden border-r border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 lg:block">
          <div className="mb-5 flex items-center gap-2 px-2 py-2 font-semibold text-slate-800 dark:text-slate-100">
            <span className="flex size-8 items-center justify-center rounded-lg bg-cyan-700 text-white">
              <Bus className="size-4" />
            </span>
            Education Center
          </div>
          {["Dashboard", "Calendar", "Students"].map((item) => (
            <div key={item} className="rounded-md px-3 py-2 text-xs text-slate-400">{item}</div>
          ))}
          <div
            className={cn(
              "mt-2 flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition-all duration-500",
              active === 0
                ? "scale-[1.03] bg-cyan-700 text-white shadow-md ring-4 ring-cyan-200"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
            )}
          >
            <Settings className="size-4" />
            {labels.settings}
          </div>
          <div
            className={cn(
              "mt-2 flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition-all duration-500",
              active === 3
                ? "translate-x-1 bg-cyan-50 text-cyan-800 ring-2 ring-cyan-400 dark:bg-cyan-950 dark:text-cyan-100"
                : "text-slate-300 dark:text-slate-700",
            )}
          >
            <Bus className="size-4" />
            {labels.transport}
          </div>
        </div>

        <div className="min-w-0 p-4 sm:p-6">
          <div className="mx-auto max-w-2xl rounded-xl bg-white p-4 shadow-sm dark:bg-slate-900 sm:p-6">
            <div className="mb-5 flex gap-2 overflow-hidden border-b border-slate-200 pb-3 dark:border-slate-800">
              {[labels.settings, labels.transport, "AI", "Access"].map((tab, index) => (
                <span
                  key={tab}
                  className={cn(
                    "whitespace-nowrap rounded-md px-3 py-2 text-xs transition-all duration-500",
                    index === 1 && active >= 1
                      ? "bg-cyan-700 font-semibold text-white ring-4 ring-cyan-100 dark:ring-cyan-950"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
                  )}
                >
                  {tab}
                </span>
              ))}
            </div>

            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
                <Bus className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-slate-900 dark:text-white">{labels.transport}</p>
                  {active === 3 && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                      {labels.active}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-400">{labels.moduleIntro}</p>
              </div>
            </div>

            <div
              className={cn(
                "mt-5 flex items-center justify-between rounded-lg border p-3 transition-all duration-500",
                active === 2
                  ? "scale-[1.02] border-cyan-500 bg-cyan-50 shadow-md ring-4 ring-cyan-100 dark:bg-cyan-950/40 dark:ring-cyan-950"
                  : "border-slate-200 dark:border-slate-800",
              )}
            >
              <span className="text-sm text-slate-700 dark:text-slate-200">{labels.enable}</span>
              <span
                className={cn(
                  "flex h-6 w-11 items-center rounded-full p-0.5 transition-colors duration-500",
                  active >= 2 ? "bg-cyan-700" : "bg-slate-300 dark:bg-slate-700",
                )}
              >
                <span
                  className={cn(
                    "size-5 rounded-full bg-white shadow transition-transform duration-500",
                    active >= 2 && "translate-x-5",
                  )}
                />
              </span>
            </div>

            <div
              className={cn(
                "mt-3 rounded-lg border p-3 transition-all duration-500",
                active === 2
                  ? "border-cyan-300 bg-cyan-50/50 dark:border-cyan-800 dark:bg-cyan-950/20"
                  : "border-slate-200 dark:border-slate-800",
              )}
            >
              <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <MapPin className="size-4 text-cyan-700" />
                {labels.centreLocation}
              </div>
              <div className="mt-3 h-14 rounded-md bg-[linear-gradient(135deg,#e2e8f0_25%,transparent_25%),linear-gradient(225deg,#e2e8f0_25%,transparent_25%),linear-gradient(45deg,#e2e8f0_25%,transparent_25%),linear-gradient(315deg,#e2e8f0_25%,#f8fafc_25%)] bg-[length:18px_18px] bg-[position:9px_0,9px_0,0_0,0_0] dark:opacity-60" />
            </div>

            <div className="mt-5 flex justify-end">
              <span
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white transition-all duration-500",
                  active === 3 && "scale-105 shadow-lg ring-4 ring-cyan-200 dark:ring-cyan-950",
                )}
              >
                {active === 3 ? <Check className="size-4" /> : <Save className="size-4" />}
                {labels.save}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-border bg-card p-4 sm:px-5">
        <div className="flex gap-2" role="tablist" aria-label={labels.title}>
          {steps.map((step, index) => (
            <button
              key={step.title}
              type="button"
              role="tab"
              aria-selected={active === index}
              onClick={() => {
                setPlaying(false);
                setActive(index);
              }}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                active === index ? "bg-primary" : "bg-muted",
              )}
            >
              <span className="sr-only">{step.title}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{steps[active]?.description}</p>
      </div>
    </section>
  );
}
