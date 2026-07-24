"use client";

import { useState, type ReactNode } from "react";
import {
  Building2,
  GraduationCap,
  Wallet,
  Bus,
  Sparkles,
  UsersRound,
  Database,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type SettingsSection = { key: string; label: string; node: ReactNode };
export type SettingsGroup = { key: string; label: string; sections: SettingsSection[] };

const ICONS: Record<string, LucideIcon> = {
  center: Building2,
  academic: GraduationCap,
  finance: Wallet,
  transport: Bus,
  ai: Sparkles,
  access: UsersRound,
  system: Database,
};

/**
 * Tabbed settings: a vertical rail of top-level groups on the inline-start side
 * and, inside each group, a row of sub-tab pills. Replaces the long scroll of
 * collapsible cards. The active group/section is mirrored into the URL
 * (?tab=&sub=) so a section can be linked and survives a refresh — without a
 * navigation round-trip, since everything is already rendered.
 */
export function SettingsShell({
  groups,
  initialTab,
  initialSub,
}: {
  groups: SettingsGroup[];
  initialTab?: string;
  initialSub?: string;
}) {
  const firstTab = groups.find((g) => g.key === initialTab) ? initialTab! : groups[0]?.key;
  const [tab, setTab] = useState(firstTab);
  const group = groups.find((g) => g.key === tab) ?? groups[0];

  const firstSub =
    group?.sections.find((s) => s.key === initialSub)?.key ?? group?.sections[0]?.key;
  const [subByTab, setSubByTab] = useState<Record<string, string>>(
    group ? { [group.key]: firstSub ?? "" } : {},
  );

  function sync(nextTab: string, nextSub: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", nextTab);
    if (nextSub) url.searchParams.set("sub", nextSub);
    else url.searchParams.delete("sub");
    window.history.replaceState(null, "", url.toString());
  }

  function pickTab(g: SettingsGroup) {
    setTab(g.key);
    const sub = subByTab[g.key] ?? g.sections[0]?.key ?? "";
    setSubByTab((m) => ({ ...m, [g.key]: sub }));
    sync(g.key, g.sections.length > 1 ? sub : "");
  }

  function pickSub(sectionKey: string) {
    setSubByTab((m) => ({ ...m, [group.key]: sectionKey }));
    sync(group.key, sectionKey);
  }

  const activeSub = subByTab[group.key] ?? group.sections[0]?.key;
  const section = group.sections.find((s) => s.key === activeSub) ?? group.sections[0];

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      {/* Group rail */}
      <nav
        aria-label={group.label}
        className="flex shrink-0 gap-1 overflow-x-auto md:w-56 md:flex-col md:overflow-visible"
      >
        {groups.map((g) => {
          const Icon = ICONS[g.key] ?? Database;
          const active = g.key === group.key;
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => pickTab(g)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                "md:w-full md:justify-start",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {g.label}
            </button>
          );
        })}
      </nav>

      {/* Content pane */}
      <div className="min-w-0 flex-1">
        {group.sections.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-1 border-b border-border pb-2">
            {group.sections.map((s) => {
              const active = s.key === section.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => pickSub(s.key)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        )}

        <Card>
          <CardContent className="p-5">
            <h2 className="mb-4 text-lg font-semibold">{section.label}</h2>
            {section.node}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
