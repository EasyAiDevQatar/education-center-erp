"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Lock, LockOpen, ShieldCheck } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { FormField } from "@/components/crud/form-field";
import { unlockConnect, setConnectPassword, lockConnect } from "./connect-gate-actions";

/**
 * The lock in front of the messaging module.
 *
 * Two states worth distinguishing: no password has ever been set — in which
 * case somebody has to choose one — and a password exists and is being asked
 * for. Showing the same form for both is how a first-run screen ends up
 * looking like a failed login.
 */
export function ConnectGate({ isSet }: { isSet: boolean }) {
  const t = useTranslations("connectGate");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      if (!isSet && password !== confirm) {
        setError("mismatch");
        return;
      }
      const res = isSet
        ? await unlockConnect(locale, password)
        : await setConnectPassword(locale, password);
      if (res.ok) {
        setPassword("");
        setConfirm("");
        router.refresh();
      } else setError(res.error ?? "wrongPassword");
    });

  return (
    <div className="mx-auto max-w-md rounded-lg border border-border p-6 text-center">
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
        <Lock className="size-6 text-muted-foreground" />
      </div>
      <p className="font-semibold">{isSet ? t("lockedTitle") : t("setTitle")}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {isSet ? t("lockedIntro") : t("setIntro")}
      </p>

      <div className="mt-4 space-y-3 text-start">
        <FormField label={t("password")} htmlFor="connect-pw">
          <PasswordInput
            id="connect-pw"
            dir="ltr"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !pending && submit()}
          />
        </FormField>
        {!isSet && (
          <FormField label={t("confirm")} htmlFor="connect-pw2">
            <PasswordInput
              id="connect-pw2"
              dir="ltr"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !pending && submit()}
            />
          </FormField>
        )}
        {error && (
          <p className="text-sm text-destructive">
            {t.has(`errors.${error}`) ? t(`errors.${error}`) : error}
          </p>
        )}
        <Button type="button" className="w-full" disabled={pending || !password} onClick={submit}>
          {pending ? tc("saving") : isSet ? t("unlock") : t("setAction")}
        </Button>
      </div>
    </div>
  );
}

/** Shown once the gate is open, so it is obvious the module is unlocked. */
export function ConnectUnlockedBar() {
  const t = useTranslations("connectGate");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-3">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 text-[var(--success)]" />
        {t("unlockedNote")}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => start(async () => { await lockConnect(locale); router.refresh(); })}
      >
        <LockOpen className="me-1 size-4" />
        {t("lockNow")}
      </Button>
    </div>
  );
}
