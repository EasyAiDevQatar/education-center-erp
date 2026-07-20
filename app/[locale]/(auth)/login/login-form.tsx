"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { loginAction, type LoginState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const action = loginAction.bind(null, locale);
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    action,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          dir="ltr"
          placeholder="admin@center.qa"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          dir="ltr"
        />
      </div>
      {state.error && (
        <p className="text-sm text-destructive">{t("invalidCredentials")}</p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("signingIn") : t("signIn")}
      </Button>
    </form>
  );
}
