"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Menu, GraduationCap, LogOut, ChevronDown } from "lucide-react";
import { ProfileMenu, type RoleOption } from "./profile-menu";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/enums";
import { NAV_ITEMS } from "./nav-items";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ChangePasswordDialog } from "./change-password-dialog";
import { Button } from "@/components/ui/button";

// Render order. A section with no visible items produces nothing.
const SECTIONS = ["operations", "people", "finance", "hr", "admin"] as const;

/** Which groups the user has folded away, remembered between visits. */
const COLLAPSED_KEY = "ec-nav-collapsed";

export function AppShell({
  role,
  userName,
  roleLabel,
  onLogout,
  flags,
  perms,
  roles,
  activeRoleKey,
  children,
}: {
  role: Role;
  userName: string;
  roleLabel: string;
  onLogout: () => void;
  /** Optional-module switches, read from Settings by the server layout. */
  flags?: { accounting?: boolean; transport?: boolean; ai?: boolean };
  /** Per-role menu narrowing (navKey → allowed). Only `false` entries hide. */
  perms?: Record<string, boolean>;
  /** Roles the user may switch between, and the active one. */
  roles?: RoleOption[];
  activeRoleKey?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Everything starts expanded and the saved state is applied after mount:
  // reading localStorage during render would make the server and client markup
  // disagree and React would throw away the whole tree.
  const [collapsed, setCollapsed] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSED_KEY);
      if (raw) setCollapsed(JSON.parse(raw) as string[]);
    } catch {
      // A blocked or corrupt store just means the default: all expanded.
    }
  }, []);

  const toggleSection = (section: string) =>
    setCollapsed((prev) => {
      const next = prev.includes(section)
        ? prev.filter((s) => s !== section)
        : [...prev, section];
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // Not being able to remember it is not a reason to refuse the toggle.
      }
      return next;
    });

  const items = NAV_ITEMS.filter(
    (i) =>
      i.roles.includes(role) &&
      (!i.flag || flags?.[i.flag]) &&
      perms?.[i.key] !== false,
  );

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const nav = (
    <nav className="flex flex-col gap-4 p-3">
      {SECTIONS.map((section) => {
        const inSection = items.filter((i) => i.section === section);
        if (inSection.length === 0) return null;
        // A group holding the current page stays open regardless of what was
        // saved — losing sight of where you are is worse than an extra click.
        const holdsActive = inSection.some((i) => isActive(i.href));
        const isCollapsed = collapsed.includes(section) && !holdsActive;
        return (
          <div key={section} className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => toggleSection(section)}
              aria-expanded={!isCollapsed}
              className="flex w-full items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
            >
              <span>{t(`sections.${section}`)}</span>
              <ChevronDown
                className={cn(
                  "ms-auto size-3.5 shrink-0 transition-transform",
                  isCollapsed && "-rotate-90 rtl:rotate-90",
                )}
              />
            </button>
            {!isCollapsed && inSection.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <div key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span>{t(item.key)}</span>
                  </Link>

                  {/* Sub-links appear only while their branch is open, so the
                      sidebar stays short for the sections you aren't using. */}
                  {item.children && active && (
                    <div className="mt-1 flex flex-col gap-0.5 border-s border-border ms-5 ps-2">
                      {item.children.map((child) => {
                        // Exact match: /checkin must not light up on /checkin/cards.
                        const childActive = pathname === child.href;
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={() => setOpen(false)}
                            className={cn(
                              "rounded-md px-3 py-1.5 text-sm transition-colors",
                              childActive
                                ? "bg-accent font-medium text-accent-foreground"
                                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                            )}
                          >
                            {t(child.key)}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-2 border-b border-border px-5 py-4">
      <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <GraduationCap className="size-5" />
      </div>
      <span className="font-bold">{tc("appShort")}</span>
    </div>
  );

  return (
    <div className="flex min-h-svh">
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-svh w-64 shrink-0 flex-col overflow-y-auto border-e border-border bg-card md:flex">
        {brand}
        {nav}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="no-print fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 start-0 z-50 flex w-64 flex-col overflow-y-auto border-e border-border bg-card">
            {brand}
            {nav}
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-card/80 px-4 backdrop-blur">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label="Menu"
            >
              {open ? <Menu className="size-5" /> : <Menu className="size-5" />}
            </Button>
            <ProfileMenu
              userName={userName}
              activeRoleKey={activeRoleKey ?? role}
              roles={roles ?? [{ key: role, label: roleLabel }]}
            />
          </div>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ChangePasswordDialog />
            <form action={onLogout}>
              <Button variant="ghost" size="sm" type="submit" className="gap-2">
                <LogOut className="size-4" />
                <span className="hidden sm:inline">{t("logout")}</span>
              </Button>
            </form>
          </div>
        </header>
        <main className="flex-1 p-4 print:p-0 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
