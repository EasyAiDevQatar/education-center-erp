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
                await action();
                setOpen(false);
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
