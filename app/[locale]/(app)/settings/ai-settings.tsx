"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Sparkles, PlugZap } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/crud/form-field";
import { AI_PRESETS, AI_PROVIDERS, type AiProvider } from "@/lib/ai/presets";
import { saveAiSettings, testAiConnection } from "./ai-actions";

export type AiValues = {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  /** Masked for display; empty means no key stored yet. */
  apiKeyMasked: string;
  autoTranslateNames: boolean;
  assistantRoles: string[];
};

const ROLES = ["ADMIN", "ACCOUNTANT", "RECEPTIONIST"] as const;

export function AiSettings({ values }: { values: AiValues }) {
  const t = useTranslations("ai");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const locale = useLocale();
  const router = useRouter();

  const [provider, setProvider] = useState(values.provider);
  const [baseUrl, setBaseUrl] = useState(values.baseUrl);
  const [model, setModel] = useState(values.model);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();

  function onProviderChange(p: string) {
    setProvider(p);
    const preset = AI_PRESETS[p as AiProvider];
    if (preset) {
      // Presets prefill; the admin can still override either field.
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setMsg(null);
    setErr(null);
    start(async () => {
      const r = await saveAiSettings(locale, {}, fd);
      if (r.ok) {
        setMsg(tc("saved"));
        router.refresh();
      } else setErr(r.error ?? "invalid");
    });
  }

  function onTest() {
    setMsg(null);
    setErr(null);
    startTest(async () => {
      const r = await testAiConnection();
      if (r.ok) setMsg(t("testOk"));
      else setErr(`${t("testFail")}${r.message ? ` — ${r.message}` : ""}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-5 text-primary" />
        <span className="font-semibold">{t("moduleTitle")}</span>
        {values.enabled && <Badge variant="success">{tc("active")}</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">{t("moduleIntro")}</p>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="aiEnabled" defaultChecked={values.enabled} className="size-4 accent-primary" />
        {t("enableLabel")}
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("provider")} htmlFor="aiProvider" hint={t("providerHint")}>
          <Select id="aiProvider" name="aiProvider" value={provider} onChange={(e) => onProviderChange(e.target.value)}>
            {AI_PROVIDERS.map((p) => (
              <option key={p} value={p}>{t(`providers.${p}`)}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("model")} htmlFor="aiModel">
          <Input id="aiModel" name="aiModel" dir="ltr" value={model} onChange={(e) => setModel(e.target.value)} />
        </FormField>
      </div>

      <FormField label={t("baseUrl")} htmlFor="aiBaseUrl">
        <Input id="aiBaseUrl" name="aiBaseUrl" dir="ltr" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </FormField>

      <FormField
        label={t("apiKey")}
        htmlFor="aiApiKey"
        hint={values.apiKeyMasked ? t("apiKeyStored", { masked: values.apiKeyMasked }) : t("apiKeyHint")}
      >
        <Input id="aiApiKey" name="aiApiKey" type="password" dir="ltr" autoComplete="off" placeholder={values.apiKeyMasked || "sk-…"} />
      </FormField>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="aiAutoTranslateNames"
          defaultChecked={values.autoTranslateNames}
          className="size-4 accent-primary"
        />
        {t("autoTranslate")}
      </label>
      <p className="text-xs text-muted-foreground">{t("autoTranslateHint")}</p>

      <div className="space-y-1">
        <p className="text-sm font-medium">{t("assistantRoles")}</p>
        <p className="text-xs text-muted-foreground">{t("assistantRolesHint")}</p>
        <div className="flex flex-wrap gap-4">
          {ROLES.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="aiAssistantRoles"
                value={r}
                defaultChecked={values.assistantRoles.includes(r)}
                disabled={r === "ADMIN"}
                className="size-4 accent-primary"
              />
              {tr(r)}
            </label>
          ))}
          {/* ADMIN is always allowed; a disabled checkbox does not post, so keep it via hidden input. */}
          <input type="hidden" name="aiAssistantRoles" value="ADMIN" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>{pending ? tc("saving") : tc("save")}</Button>
        <Button type="button" variant="outline" className="gap-1" disabled={testing} onClick={onTest}>
          <PlugZap className="size-4" />
          {testing ? t("testing") : t("testConnection")}
        </Button>
        {msg && <span className="text-sm text-success">{msg}</span>}
        {err && <span className="text-sm text-destructive">{err}</span>}
      </div>
    </form>
  );
}
