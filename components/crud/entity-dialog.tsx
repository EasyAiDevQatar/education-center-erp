"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
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

type ActionState = { ok?: boolean; error?: string };
type ActionFn = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * Generic create/edit dialog. Renders `fields` inside a form, submits to the
 * bound server `action`, and closes on success. Reusable across all entities.
 */
export function EntityDialog({
  title,
  trigger,
  action,
  fields,
}: {
  title: string;
  trigger: ReactNode;
  action: ActionFn;
  fields: ReactNode;
}) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const res = await action({}, fd);
      if (res.ok) setOpen(false);
      else setError(res.error ?? "invalid");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {/* key resets uncontrolled fields each time the dialog opens */}
        <form key={String(open)} onSubmit={onSubmit} className="space-y-3">
          {fields}
          {error && (
            <p className="text-sm text-destructive">
              {error === "forbidden" ? "—" : t("required")}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
