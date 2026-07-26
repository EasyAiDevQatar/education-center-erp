"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Blocks } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { OPTIONAL_MODULES, type OptionalModule } from "@/lib/modules-shared";
import { saveOptionalModules } from "./modules-actions";

/**
 * Which optional parts of the system this centre runs.
 *
 * One panel for all three because none of them has any other setting; a tab each
 * would be three clicks to reach one checkbox. Off never deletes anything, and
 * the copy says so — the fear with a switch like this is that it throws work
 * away, and a centre that believes that will never touch it.
 */
export function ModulesSettings({ values }: { values: Record<OptionalModule, boolean> }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [on, setOn] = useState<Record<OptionalModule, boolean>>(values);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const LABELS: Record<OptionalModule, { label: string; hint: string }> = {
    hr: { label: t("moduleHr"), hint: t("moduleHrHint") },
    reports: { label: t("moduleReports"), hint: t("moduleReportsHint") },
    leads: { label: t("moduleLeads"), hint: t("moduleLeadsHint") },
  };

  const save = () =>
    start(async () => {
      setMsg(null);
      setErr(null);
      const r = await saveOptionalModules(locale, on);
      if (r.error) {
        setErr(r.error);
        return;
      }
      setMsg(tc("saved"));
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Blocks className="size-5 text-primary" />
        <span className="font-semibold">{t("modulesSettings")}</span>
      </div>
      <p className="text-sm text-muted-foreground">{t("modulesIntro")}</p>

      <div className="space-y-2">
        {OPTIONAL_MODULES.map((m) => (
          <label
            key={m}
            className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 transition hover:bg-accent"
          >
            <input
              type="checkbox"
              checked={on[m]}
              onChange={(e) => setOn((p) => ({ ...p, [m]: e.target.checked }))}
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{LABELS[m].label}</span>
              <span className="block text-xs text-muted-foreground">{LABELS[m].hint}</span>
            </span>
          </label>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{t("modulesDataKept")}</p>

      <div className="flex items-center gap-3">
        <Button size="sm" disabled={pending} onClick={save}>
          {tc("save")}
        </Button>
        {msg && <p className="text-sm text-[var(--success)]">{msg}</p>}
        {err && <p className="text-sm text-destructive">{tc(`errors.${err}`)}</p>}
      </div>
    </div>
  );
}
