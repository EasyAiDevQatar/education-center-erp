"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { overrideApprove } from "./actions";

/**
 * Exceptional approval of a BLOCKED (INVALID) trip. Never a silent path: the
 * only way past the validator, admin-only, and it demands a written reason that
 * is stored + audited (overrideApprove). The trip's own errors stay on screen —
 * this records that a human accepted the risk, it does not erase it.
 */
export function OverrideDialog({
  tripId,
  onDone,
}: {
  tripId: string;
  onDone: () => void;
}) {
  const t = useTranslations("transportPlanner");
  const tc = useTranslations("common");
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (reason.trim().length < 3) {
      setError(t("overrideReasonRequired"));
      return;
    }
    start(async () => {
      const r = await overrideApprove(locale, tripId, reason.trim());
      if (r.ok) {
        setOpen(false);
        setReason("");
        setError(null);
        onDone();
      } else {
        setError(r.error === "reasonRequired" ? t("overrideReasonRequired") : tc("errorGeneric"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="destructive" className="gap-1">
          <ShieldAlert className="size-3.5" />
          {t("overrideApprove")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("overrideApprove")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
            {t("overrideWarning")}
          </p>
          <label className="block text-sm font-medium" htmlFor="ov-reason">
            {t("overrideReasonLabel")}
          </label>
          <textarea
            id="ov-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-border bg-background p-2 text-sm"
            placeholder={t("overrideReasonPlaceholder")}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("cancel")}</Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || reason.trim().length < 3}
            onClick={submit}
          >
            {pending ? tc("saving") : t("overrideConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
