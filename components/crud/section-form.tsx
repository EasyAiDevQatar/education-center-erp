"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

type ActionState = { ok?: boolean; error?: string };

/** A standalone settings form: renders children + a save button, submits to a
 *  bound server action, and shows a transient "saved" indicator. */
export function SectionForm({
  action,
  children,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode;
}) {
  const t = useTranslations("common");
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSaved(false);
    start(async () => {
      const res = await action({}, fd);
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {children}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-sm text-[var(--success)]">
            <Check className="size-4" />
            {t("saved")}
          </span>
        )}
      </div>
    </form>
  );
}
