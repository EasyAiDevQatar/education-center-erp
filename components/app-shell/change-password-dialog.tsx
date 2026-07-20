"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { KeyRound, CheckCircle2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { changeOwnPassword } from "@/app/[locale]/(app)/actions";

/** Header control letting any signed-in user change their own password. */
export function ChangePasswordDialog() {
  const t = useTranslations("users");
  const tc = useTranslations("common");

  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const res = await changeOwnPassword({}, fd);
      if (res.ok) {
        setDone(true);
        setTimeout(() => {
          setOpen(false);
          setDone(false);
        }, 1200);
      } else setError(res.error ?? "invalid");
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); setError(null); setDone(false); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2" title={t("changePassword")}>
          <KeyRound className="size-4" />
          <span className="hidden lg:inline">{t("changePassword")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("changePassword")}</DialogTitle>
        </DialogHeader>
        {done ? (
          <p className="flex items-center gap-2 py-4 text-sm text-[var(--success)]">
            <CheckCircle2 className="size-5" />
            {tc("saved")}
          </p>
        ) : (
          <form key={String(open)} onSubmit={onSubmit} className="space-y-3">
            <FormField label={t("currentPassword")} htmlFor="cp-current">
              <PasswordInput id="cp-current" name="current" dir="ltr" autoComplete="current-password" required />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t("newPassword")} htmlFor="cp-next">
                <PasswordInput id="cp-next" name="next" dir="ltr" autoComplete="new-password" required />
              </FormField>
              <FormField label={t("confirmPassword")} htmlFor="cp-confirm">
                <PasswordInput id="cp-confirm" name="confirm" dir="ltr" autoComplete="new-password" required />
              </FormField>
            </div>
            <p className="text-xs text-muted-foreground">{t("passwordMin")}</p>
            {error && (
              <p className="text-sm text-destructive">
                {tc.has(`errors.${error}`) ? tc(`errors.${error}`) : tc("required")}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">{tc("cancel")}</Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? tc("saving") : tc("save")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
