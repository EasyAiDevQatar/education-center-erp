"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Menu, X, GraduationCap, LogOut } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/enums";
import { NAV_ITEMS } from "./nav-items";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ChangePasswordDialog } from "./change-password-dialog";
import { Button } from "@/components/ui/button";

const SECTIONS = ["operations", "finance", "admin"] as const;

export function AppShell({
  role,
  userName,
  roleLabel,
  onLogout,
  children,
}: {
  role: Role;
  userName: string;
  roleLabel: string;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const items = NAV_ITEMS.filter((i) => i.roles.includes(role));

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const nav = (
    <nav className="flex flex-col gap-4 p-3">
      {SECTIONS.map((section) => {
        const inSection = items.filter((i) => i.section === section);
        if (inSection.length === 0) return null;
        return (
          <div key={section} className="flex flex-col gap-1">
            <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`sections.${section}`)}
            </p>
            {inSection.map((item) => {
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
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col overflow-y-auto border-e border-border bg-card md:flex">
        {brand}
        {nav}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
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
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-card/80 px-4 backdrop-blur">
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
            <div className="hidden flex-col leading-tight sm:flex">
              <span className="text-sm font-semibold">{userName}</span>
              <span className="text-xs text-muted-foreground">{roleLabel}</span>
            </div>
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
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
