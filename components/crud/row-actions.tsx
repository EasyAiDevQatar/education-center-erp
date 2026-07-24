"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Eye } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * The action cell every table shares.
 *
 * Order is fixed — view, edit, delete — so the same icon is always in the same
 * place whichever register you are on. Registers used to differ: some had a
 * 360° link, most had only a pencil, and a few had a pencil and a bin, which
 * meant the same gesture did different things from screen to screen.
 */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex justify-center gap-1">{children}</div>;
}

export type ViewField = {
  label: string;
  /** Rendered as-is, so a badge or a link is fine. Falsy shows a dash. */
  value: ReactNode;
  /** Numbers, dates, plates and phones read left-to-right even in Arabic. */
  ltr?: boolean;
  /** Give the value its own row — long notes and addresses need the width. */
  wide?: boolean;
};

/**
 * Read-only detail for records that have no 360° page of their own.
 *
 * Opening a record to *look* at it should never mean opening the edit form:
 * that invites accidental changes, and a form hides anything it has no input
 * for (linked totals, computed status, timestamps).
 */
export function ViewDialog({
  title,
  subtitle,
  fields,
  footer,
  trigger,
}: {
  title: string;
  subtitle?: ReactNode;
  fields: ViewField[];
  /** Extra actions — "open the full profile", "print", and so on. */
  footer?: ReactNode;
  trigger?: ReactNode;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" aria-label={t("view")} title={t("view")}>
            <Eye className="size-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {subtitle && <p className="-mt-2 text-sm text-muted-foreground">{subtitle}</p>}

        <dl className="max-h-[60vh] space-y-1 overflow-y-auto pe-1 text-sm">
          {fields.map((f, i) => (
            <div
              key={`${f.label}-${i}`}
              className={
                f.wide
                  ? "rounded-md border border-border p-2"
                  : "flex items-start justify-between gap-4 rounded-md border border-border px-2 py-1.5"
              }
            >
              <dt className="shrink-0 text-muted-foreground">{f.label}</dt>
              <dd
                className={[
                  f.wide ? "mt-1" : "text-end",
                  f.ltr ? "tabular-nums" : "",
                ].join(" ")}
                {...(f.ltr ? { dir: "ltr" } : {})}
              >
                {f.value === null || f.value === undefined || f.value === "" ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  f.value
                )}
              </dd>
            </div>
          ))}
        </dl>

        <DialogFooter>
          {footer}
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("close")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
