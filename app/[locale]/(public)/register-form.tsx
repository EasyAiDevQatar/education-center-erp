"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Send, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createPublicLead } from "./actions";

type LevelOpt = { id: string; label: string };

export function RegisterForm({ levels }: { levels: LevelOpt[] }) {
  const t = useTranslations("site");
  const locale = useLocale();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-[var(--success)]/40 bg-success/10 p-4">
        <CheckCircle2 className="size-6 shrink-0 text-[var(--success)]" />
        <p className="text-sm font-medium">{t("registerDone")}</p>
      </div>
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const res = await createPublicLead(locale, {}, fd);
      if (res.ok) setDone(true);
      else setError(res.error ?? "invalid");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {/* Honeypot — hidden from humans, irresistible to bots. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute -start-[9999px] h-0 w-0 opacity-0"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="name" placeholder={t("registerName")} required minLength={2} />
        <Input
          name="phone"
          dir="ltr"
          inputMode="tel"
          placeholder={t("registerPhone")}
          required
          pattern="[+0-9\s-]{8,16}"
        />
      </div>
      {levels.length > 0 && (
        <Select name="gradeLevelId" defaultValue="">
          <option value="">{t("registerLevel")}</option>
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </Select>
      )}
      <Input name="notes" placeholder={t("registerNotes")} />
      {error && (
        <p className="text-sm text-destructive">
          {error === "locked" ? t("registerLocked") : t("registerInvalid")}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full gap-2 sm:w-auto">
        <Send className="size-4" />
        {pending ? t("registerSending") : t("registerCta")}
      </Button>
    </form>
  );
}
