"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Route, ExternalLink } from "lucide-react";
import { Link } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { generateTrips } from "@/app/[locale]/(app)/transport/planner/actions";

export type TripPromptInfo = { count: number; date: string };

/**
 * "You just confirmed home session(s) with no ride — plan trips now?"
 *
 * Shown after confirming (or booking) HOME sessions that no trip serves yet.
 * Auto-plan runs the existing day generator (proposals only, never
 * dispatches); the link opens the transport planner for review either way.
 */
export function TripPromptDialog({
  info,
  onClose,
}: {
  info: TripPromptInfo | null;
  onClose: () => void;
}) {
  const t = useTranslations("tripPrompt");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const close = () => {
    setResult(null);
    onClose();
  };

  async function autoPlan() {
    if (!info) return;
    setBusy(true);
    try {
      const res = await generateTrips(locale, info.date);
      if (res.ok && res.message) {
        // message is "created/refreshed/locked/unassigned" from the generator.
        const [created, , , unassigned] = res.message.split("/").map(Number);
        setResult(t("result", { created: created || 0, unassigned: unassigned || 0 }));
      } else {
        setResult(t("failed"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!info} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Route className="size-5 text-warning" />
            {t("title")}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm">{info && t("text", { n: info.count })}</p>
        {result && <p className="rounded-md bg-accent px-3 py-2 text-sm">{result}</p>}
        <DialogFooter className="flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={close}>
            {t("later")}
          </Button>
          {info && (
            <Link href={`/transport/planner?date=${info.date}`}>
              <Button type="button" variant="secondary" className="gap-1">
                <ExternalLink className="size-4" />
                {t("openPlanner")}
              </Button>
            </Link>
          )}
          <Button type="button" onClick={autoPlan} disabled={busy || !!result}>
            {busy ? t("planning") : t("autoPlan")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
