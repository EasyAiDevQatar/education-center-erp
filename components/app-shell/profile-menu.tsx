"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { UserCircle2, ChevronDown, Check, Repeat } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { switchRole } from "./profile-actions";

export type RoleOption = { key: string; label: string };

/**
 * The user profile at the top of the header: name, active role, and — when the
 * user holds more than one role — a switcher that re-issues the session as the
 * chosen role and reloads.
 */
export function ProfileMenu({
  userName,
  activeRoleKey,
  roles,
}: {
  userName: string;
  activeRoleKey: string;
  roles: RoleOption[];
}) {
  const t = useTranslations("profile");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const active = roles.find((r) => r.key === activeRoleKey);

  const pick = (key: string) => {
    if (key === activeRoleKey) return setOpen(false);
    start(async () => {
      const r = await switchRole(key);
      if (r.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md px-2 py-1 text-start transition-colors hover:bg-accent"
      >
        <UserCircle2 className="size-7 shrink-0 text-muted-foreground" />
        <span className="hidden flex-col leading-tight sm:flex">
          <span className="text-sm font-semibold">{userName}</span>
          <span className="text-xs text-muted-foreground">{active?.label ?? activeRoleKey}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute top-full z-50 mt-1 w-60 rounded-lg border border-border bg-popover p-1 shadow-xl">
          <div className="px-3 py-2">
            <p className="text-sm font-semibold">{userName}</p>
            <p className="text-xs text-muted-foreground">{active?.label ?? activeRoleKey}</p>
          </div>
          {roles.length > 1 && (
            <div className="border-t border-border pt-1">
              <p className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-muted-foreground">
                <Repeat className="size-3.5" />
                {t("switchRole")}
              </p>
              {roles.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  disabled={pending}
                  onClick={() => pick(r.key)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-start text-sm transition-colors hover:bg-accent",
                    r.key === activeRoleKey && "font-semibold",
                  )}
                >
                  <Check className={cn("size-4", r.key === activeRoleKey ? "opacity-100" : "opacity-0")} />
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
