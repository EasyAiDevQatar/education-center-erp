"use client";

import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const PERIODS = ["all", "thisMonth", "lastMonth", "thisYear"] as const;

/** Period chips for the dashboard KPIs (the trend chart stays 12-month). */
export function PeriodSelector({ active }: { active: string }) {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1 rounded-md border border-border bg-card p-1">
      {PERIODS.map((p) => (
        <button
          key={p}
          onClick={() => router.push(p === "all" ? pathname : `${pathname}?period=${p}`)}
          className={cn(
            "rounded px-3 py-1 text-sm transition-colors",
            p === active
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          {p === "all" ? tc("all") : t(p)}
        </button>
      ))}
    </div>
  );
}
