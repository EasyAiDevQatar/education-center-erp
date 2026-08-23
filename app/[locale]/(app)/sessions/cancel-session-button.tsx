"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function CancelSessionButton({
  action,
}: {
  action: () => Promise<{ ok?: boolean; error?: string }>;
}) {
  const t = useTranslations("sessions");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        className="text-destructive hover:text-destructive"
        aria-label={t("cancelSession")}
        title={t("cancelSession")}
        onClick={() => setOpen(true)}
      >
        <Ban className="size-4" />
      </Button>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("cancelConfirm")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("cancelHint")}</p>
        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {tc.has(`errors.${error}`) ? tc(`errors.${error}`) : tc("errorGeneric")}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("back")}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const result = await action();
                if (result.error) setError(result.error);
                else setOpen(false);
              })
            }
          >
            {t("cancelSession")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
