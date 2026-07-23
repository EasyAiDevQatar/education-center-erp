"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Landmark } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/crud/form-field";
import { runBackfill, saveAccountingSettings } from "./accounting-actions";

export type ChequeSettingsValues = {
  confReceived: string;
  confPending: string;
  confDeposited: string;
  alertDays: string;
  template: Record<string, number>;
};

export function AccountingSettings({
  enabled,
  cheque,
}: {
  enabled: boolean;
  cheque: ChequeSettingsValues;
}) {
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
      {enabled && (
        <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
          <p className="text-sm font-medium">{t("chequeSettingsTitle")}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <FormField label={t("confReceived")} htmlFor="cs-cr">
              <Input id="cs-cr" name="chequeConfReceived" type="number" min="0" max="100" dir="ltr" defaultValue={cheque.confReceived} />
            </FormField>
            <FormField label={t("confPending")} htmlFor="cs-cp">
              <Input id="cs-cp" name="chequeConfPending" type="number" min="0" max="100" dir="ltr" defaultValue={cheque.confPending} />
            </FormField>
            <FormField label={t("confDeposited")} htmlFor="cs-cd">
              <Input id="cs-cd" name="chequeConfDeposited" type="number" min="0" max="100" dir="ltr" defaultValue={cheque.confDeposited} />
            </FormField>
            <FormField label={t("alertDays")} htmlFor="cs-ad">
              <Input id="cs-ad" name="chequeAlertDays" type="number" min="0" dir="ltr" defaultValue={cheque.alertDays} />
            </FormField>
          </div>
          <p className="text-sm font-medium">{t("templateTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("templateHint")}</p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {(
              [
                ["tplLeafW", "leafW"],
                ["tplLeafH", "leafH"],
                ["tplDateX", "dateX"],
                ["tplDateY", "dateY"],
                ["tplPayeeX", "payeeX"],
                ["tplPayeeY", "payeeY"],
                ["tplWordsX", "wordsX"],
                ["tplWordsY", "wordsY"],
                ["tplWordsW", "wordsW"],
                ["tplDigitsX", "digitsX"],
                ["tplDigitsY", "digitsY"],
              ] as const
            ).map(([name, key]) => (
              <FormField key={name} label={t(`tpl.${key}`)} htmlFor={name}>
                <Input
                  id={name}
                  name={name}
                  type="number"
                  step="0.5"
                  dir="ltr"
                  defaultValue={cheque.template[key] ?? ""}
                />
              </FormField>
            ))}
          </div>
          <a
            href={`/${locale}/statement/cheque/test?test=1`}
            target="_blank"
            className="text-sm text-primary underline"
          >
            {t("testPrint")}
          </a>
        </div>
      )}

      {msg && <p className="text-sm text-[var(--success)]">{msg}</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? tc("saving") : tc("save")}
      </Button>

      {enabled && <BackfillBox />}
    </form>
  );
}

/**
 * Historical import: posts existing payments/expenses/paid payslips from a
 * chosen date into the journal. Re-runnable by design.
 */
function BackfillBox() {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - 12);
    return d.toISOString().slice(0, 10);
  });
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      setResult(null);
      setErr(null);
      const r = await runBackfill(locale, from);
      if (r.ok && r.summary) {
        setResult(
          t("backfillDone", {
            created: r.summary.created ?? 0,
            scanned:
              (r.summary.payments ?? 0) + (r.summary.expenses ?? 0) + (r.summary.payslips ?? 0),
          }),
        );
      } else setErr(r.error ?? "invalid");
    });

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <p className="text-sm font-medium">{t("backfillTitle")}</p>
      <p className="text-xs text-muted-foreground">{t("backfillHint")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <FormField label={tc("from")} htmlFor="bf-from">
          <Input
            id="bf-from"
            type="date"
            dir="ltr"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </FormField>
        <Button type="button" variant="outline" disabled={pending} onClick={run}>
          {pending ? tc("saving") : t("backfillRun")}
        </Button>
      </div>
      {result && <p className="text-sm text-[var(--success)]">{result}</p>}
      {err && <p className="text-sm text-destructive">{err}</p>}
      <p className="text-xs text-muted-foreground">{t("openingBalanceHint")}</p>
    </div>
  );
}
