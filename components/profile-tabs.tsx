import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export type ProfileTab = { key: string; label: string; count?: number };

/**
 * Server-rendered tab bar for the 360° profile pages. The active tab lives in
 * the `tab` query param so each view is linkable and works without JS.
 */
export function ProfileTabs({
  tabs,
  active,
  basePath,
}: {
  tabs: ProfileTab[];
  active: string;
  basePath: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`${basePath}?tab=${t.key}`}
            className={cn(
              "-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="ms-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                {t.count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
