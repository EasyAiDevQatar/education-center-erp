"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/crud/form-field";
import { WPS_BANKS } from "@/lib/wps/banks";
import { saveWpsSettings } from "./wps-actions";

export type WpsSettingsValues = {
  wpsEmployerEID: string;
  wpsPayerEID: string;
  wpsPayerQID: string;
  wpsPayerBank: string;
  wpsPayerIBAN: string;
  wpsSifVersion: string;
  wpsBasicFloor: string;
};

export function WpsSettings({ values }: { values: WpsSettingsValues }) {
  const t = useTranslations("wps");
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
      const r = await saveWpsSettings(locale, {}, fd);
      if (r.ok) {
        setMsg(tc("saved"));
        router.refresh();
      } else setErr(r.error ?? "invalid");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("employerEID")} htmlFor="wps-eid" hint={t("employerEIDHint")}>
          <Input id="wps-eid" name="wpsEmployerEID" dir="ltr" inputMode="numeric" defaultValue={values.wpsEmployerEID} />
        </FormField>
        <FormField label={t("payerEID")} htmlFor="wps-peid" hint={t("payerHint")}>
          <Input id="wps-peid" name="wpsPayerEID" dir="ltr" inputMode="numeric" defaultValue={values.wpsPayerEID} />
        </FormField>
        <FormField label={t("payerQID")} htmlFor="wps-pqid" hint={t("payerQidHint")}>
          <Input id="wps-pqid" name="wpsPayerQID" dir="ltr" inputMode="numeric" defaultValue={values.wpsPayerQID} />
        </FormField>
        <FormField label={t("payerBank")} htmlFor="wps-bank">
          <Select id="wps-bank" name="wpsPayerBank" defaultValue={values.wpsPayerBank}>
            <option value="">—</option>
            {WPS_BANKS.map((b) => (
              <option key={b.code} value={b.code}>
                {b.code} — {b.nameEn}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("payerIBAN")} htmlFor="wps-iban" hint={t("payerIbanHint")}>
          <Input id="wps-iban" name="wpsPayerIBAN" dir="ltr" placeholder="QA…" defaultValue={values.wpsPayerIBAN} />
        </FormField>
        <FormField label={t("sifVersion")} htmlFor="wps-ver" hint={t("sifVersionHint")}>
          <Input id="wps-ver" name="wpsSifVersion" dir="ltr" defaultValue={values.wpsSifVersion || "1"} />
        </FormField>
        <FormField label={t("basicFloor")} htmlFor="wps-floor" hint={t("basicFloorHint")}>
          <Input
            id="wps-floor"
            name="wpsBasicFloor"
            type="number"
            min="0"
            step="50"
            dir="ltr"
            defaultValue={values.wpsBasicFloor}
          />
        </FormField>
      </div>

      {msg && <p className="text-sm text-[var(--success)]">{msg}</p>}
      {err && (
        <p className="text-sm text-destructive">
          {tc.has(`errors.${err}`) ? tc(`errors.${err}`) : tc("required")}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? tc("saving") : tc("save")}
      </Button>
    </form>
  );
}
