"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Users } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/crud/form-field";
import { EARNINGS_MODES, DEFAULT_EARNINGS_MODE } from "@/lib/earnings-mode";
import { saveDefaultEarningsMode, applyEarningsModeToAll } from "./earnings-actions";

/**
 * How teachers are paid, centre-wide.
 *
 * The default and the bulk apply are deliberately two separate buttons: setting
 * the default is reversible and affects only teachers who never opted out,
 * while applying to all overwrites individual choices. Merging them into one
 * "save" would make the destructive action the easy one.
 */
export function TeacherPaymentsSettings({
  defaultMode,
  overriddenCount,
  totalCount,
}: {
  defaultMode: string;
  /** Teachers with their own mode — the ones a bulk apply would overwrite. */
  overriddenCount: number;
  totalCount: number;
}) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const tm = useTranslations("earningsModes");
  const locale = useLocale();
  const router = useRouter();

  const [mode, setMode] = useState(
    EARNINGS_MODES.includes(defaultMode as never) ? defaultMode : DEFAULT_EARNINGS_MODE,
  );
  const [bulk, setBulk] = useState<string>("inherit");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; count?: number }>) =>
    start(async () => {
      setMsg(null);
      setErr(null);
      const r = await fn();
      if (r.error) {
        setErr(r.error);
        return;
      }
      setMsg(r.count === undefined ? tc("saved") : t("appliedToTeachers", { n: r.count }));
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("earningsIntro")}</p>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
        <FormField label={t("earningsDefault")} htmlFor="earn-default" hint={t("earningsDefaultHint")}>
          <Select
            id="earn-default"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="w-56"
          >
            {EARNINGS_MODES.map((m) => (
              <option key={m} value={m}>
                {tm(m)}
              </option>
            ))}
          </Select>
        </FormField>
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(() => saveDefaultEarningsMode(locale, mode))}
        >
          {tc("save")}
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-warning/40 bg-warning/5 p-3">
        <FormField label={t("earningsApplyAll")} htmlFor="earn-bulk" hint={t("earningsApplyAllHint")}>
          <Select
            id="earn-bulk"
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            className="w-56"
          >
            <option value="inherit">{t("earningsInherit")}</option>
            {EARNINGS_MODES.map((m) => (
              <option key={m} value={m}>
                {tm(m)}
              </option>
            ))}
          </Select>
        </FormField>
        <Button
          size="sm"
          variant="secondary"
          className="gap-1"
          disabled={pending}
          onClick={() => run(() => applyEarningsModeToAll(locale, bulk))}
        >
          <Users className="size-4" />
          {t("earningsApplyAllAction")}
        </Button>
        <p className="w-full text-xs text-muted-foreground">
          {t("earningsOverrideCount", { n: overriddenCount, total: totalCount })}
        </p>
      </div>

      {msg && <p className="text-sm text-[var(--success)]">{msg}</p>}
      {err && <p className="text-sm text-destructive">{tc(`errors.${err}`)}</p>}
    </div>
  );
}
