"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Landmark } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { saveAccountingSettings } from "./accounting-actions";

export function AccountingSettings({ enabled }: { enabled: boolean }) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setMsg(null);
    setErr(null);
    start(async () => {
      const r = await saveAccountingSettings(locale, {}, fd);
      if (r.ok) {
        setMsg(tc("saved"));
        router.refresh();
      } else setErr(r.error ?? "invalid");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex items-center gap-2">
        <Landmark className="size-5 text-primary" />
        <span className="font-semibold">{t("moduleTitle")}</span>
        {enabled && <Badge variant="success">{tc("active")}</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">{t("moduleIntro")}</p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="accountingEnabled"
          defaultChecked={enabled}
          className="size-4 accent-primary"
        />
        {t("enableLabel")}
      </label>
      <p className="text-xs text-muted-foreground">{t("enableHint")}</p>
      {msg && <p className="text-sm text-[var(--success)]">{msg}</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? tc("saving") : tc("save")}
      </Button>
    </form>
  );
}
