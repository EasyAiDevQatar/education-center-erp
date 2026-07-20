"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Broadcasts expand-all / collapse-all to every card on the page.
 *
 * A counter rather than a boolean: pressing "expand all" twice in a row should
 * re-expand cards the user has since closed by hand, which a boolean that is
 * already `true` would not trigger.
 */
type BulkSignal = { open: boolean; nonce: number } | null;
const BulkContext = createContext<BulkSignal>(null);

export function CollapsibleGroup({ children }: { children: ReactNode }) {
  const t = useTranslations("common");
  const [signal, setSignal] = useState<BulkSignal>(null);
  const [allOpen, setAllOpen] = useState(false);

  function toggleAll() {
    const next = !allOpen;
    setAllOpen(next);
    setSignal({ open: next, nonce: Date.now() });
  }

  return (
    <BulkContext.Provider value={signal}>
      <div className="mb-4 flex justify-end">
        <Button variant="secondary" size="sm" className="gap-1" onClick={toggleAll}>
          {allOpen ? (
            <ChevronsDownUp className="size-4" />
          ) : (
            <ChevronsUpDown className="size-4" />
          )}
          {allOpen ? t("collapseAll") : t("expandAll")}
        </Button>
      </div>
      {children}
    </BulkContext.Provider>
  );
}

/**
 * A settings section that starts collapsed.
 *
 * The body is mounted only while open, so the heavy cards (audit log, users,
 * notification log) cost nothing until asked for.
 */
export function CollapsibleCard({
  title,
  children,
  className,
  tone,
  defaultOpen = false,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  /** "danger" styles the header for destructive sections. */
  tone?: "danger";
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const signal = useContext(BulkContext);

  useEffect(() => {
    if (signal) setOpen(signal.open);
  }, [signal]);

  return (
    <Card className={cn(tone === "danger" && "border-destructive/40", className)}>
      <CardHeader className="p-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 p-4 text-start transition-colors hover:bg-accent/50"
        >
          <CardTitle className={cn("text-base", tone === "danger" && "text-destructive")}>
            {title}
          </CardTitle>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}
