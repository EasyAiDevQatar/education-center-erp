"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { createPortalLogin } from "@/app/[locale]/(app)/settings/invite-actions";

/** Admin-only: give a teacher or guardian access to their portal. */
export function PortalLoginButton({
  kind,
  recordId,
  hasLogin,
}: {
  kind: "teacher" | "guardian";
  recordId: string;
  hasLogin: boolean;
}) {
  const t = useTranslations("portal");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (hasLogin) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <KeyRound className="size-4" />
        {t("hasLogin")}
      </span>
    );
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await createPortalLogin(locale, { kind, recordId, email, password });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else setError(res.error ?? "invalid");
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" className="gap-1" onClick={() => setOpen(true)}>
        <KeyRound className="size-4" />
        {t("createLogin")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("createLogin")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("createLoginHint")}</p>
            <FormField label={tc("email")} htmlFor="pl-email">
              <Input
                id="pl-email"
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </FormField>
            <FormField label={tc("password")} htmlFor="pl-password">
              <PasswordInput
                id="pl-password"
                dir="ltr"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormField>
            {error && <p className="text-sm text-destructive">{t(`errors.${error}`)}</p>}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">{tc("cancel")}</Button>
            </DialogClose>
            <Button
              type="button"
              disabled={pending || !email || password.length < 8}
              onClick={submit}
            >
              {pending ? tc("saving") : tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
