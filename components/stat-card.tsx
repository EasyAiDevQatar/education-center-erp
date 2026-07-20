import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export function StatCard({
  label,
  value,
  suffix,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  suffix?: string;
  icon?: LucideIcon;
  tone?: "default" | "success" | "destructive" | "primary";
}) {
  const toneClass = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-[var(--success)]",
    destructive: "text-destructive",
  }[tone];

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          <p className={cn("mt-2 text-2xl font-bold tabular-nums", toneClass)}>
            {value}
            {suffix && (
              <span className="ms-1 text-sm font-medium text-muted-foreground">
                {suffix}
              </span>
            )}
          </p>
        </div>
        {Icon && (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-5" />
          </div>
        )}
      </div>
    </Card>
  );
}
