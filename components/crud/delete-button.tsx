"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Confirm-then-delete button. `action` is a bound server action. */
export function DeleteButton({
  action,
  label,
}: {
  action: () => Promise<{ ok?: boolean; error?: string }>;
  label?: string;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  // A refused delete must say why. Without this the dialog just closed and the
  // row stayed put, which reads as the button being broken.
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={t("delete")}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </Button>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{label ?? t("confirmDelete")}</DialogTitle>
        </DialogHeader>
        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errorGeneric")}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const res = await action();
                // Keep the dialog open on failure so the reason is readable.
                if (res?.error) setError(res.error);
                else setOpen(false);
              })
            }
          >
            {t("delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
