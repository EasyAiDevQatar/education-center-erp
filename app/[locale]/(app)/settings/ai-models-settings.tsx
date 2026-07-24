"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bot, Languages, ClipboardList, PlugZap } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/crud/form-field";
import { AI_PRESETS, AI_PROVIDERS, type AiProvider } from "@/lib/ai/presets";
import { saveAiModelSettings, testAiUse } from "./ai-actions";

export type AiUseValue = {
  use: string;
  override: boolean;
  provider: string;
  model: string;
  baseUrl: string;
  apiKeyMask: string;
};

const ICONS: Record<string, typeof Bot> = {
  assistant: Bot,
  translation: Languages,
  briefing: ClipboardList,
};

/**
 * Per-use AI model overrides. Each AI feature (assistant, name translation,
 * plan briefing) can be pointed at a different provider/model/key, or left to
 * inherit the default configured on the AI Assistant tab.
 */
export function AiModelsSettings({ uses }: { uses: AiUseValue[] }) {
  const t = useTranslations("ai");
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
      const r = await saveAiModelSettings(locale, {}, fd);
      if (r.ok) {
        setMsg(tc("saved"));
        router.refresh();
      } else setErr(r.error ?? "invalid");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("modelsHint")}</p>
      <div className="grid gap-4">
        {uses.map((u) => (
          <UseCard key={u.use} value={u} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending}>{pending ? tc("saving") : tc("save")}</Button>
        {msg && <span className="text-sm text-success">{msg}</span>}
        {err && <span className="text-sm text-destructive">{err}</span>}
      </div>
    </form>
  );
}

function UseCard({ value }: { value: AiUseValue }) {
  const t = useTranslations("ai");
  const [override, setOverride] = useState(value.override);
  const [provider, setProvider] = useState(value.provider || "deepseek");
  const [model, setModel] = useState(value.model);
  const [baseUrl, setBaseUrl] = useState(value.baseUrl);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testErr, setTestErr] = useState<string | null>(null);
  const [testing, startTest] = useTransition();
  const Icon = ICONS[value.use] ?? Bot;

  function onProviderChange(p: string) {
    setProvider(p);
    const preset = AI_PRESETS[p as AiProvider];
    if (preset) {
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
  }

  function onTest() {
    setTestMsg(null);
    setTestErr(null);
    startTest(async () => {
      const r = await testAiUse(value.use);
      if (r.ok) setTestMsg(t("testOk"));
      else setTestErr(`${t("testFail")}${r.message ? ` — ${r.message}` : ""}`);
    });
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="size-5 text-primary" />
          <div>
            <p className="font-medium">{t(`uses.${value.use}`)}</p>
            <p className="text-xs text-muted-foreground">{t(`useHints.${value.use}`)}</p>
          </div>
        </div>
        <label className="flex items-center gap-2 whitespace-nowrap text-sm">
          <input
            type="checkbox"
            name={`${value.use}_override`}
            checked={override}
            onChange={(e) => setOverride(e.target.checked)}
            className="size-4 accent-primary"
          />
          {t("overrideLabel")}
        </label>
      </div>

      {!override ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("usesDefault")}</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t("provider")} htmlFor={`${value.use}_provider`}>
              <Select
                id={`${value.use}_provider`}
                name={`${value.use}_provider`}
                value={provider}
                onChange={(e) => onProviderChange(e.target.value)}
              >
                {AI_PROVIDERS.map((p) => (
                  <option key={p} value={p}>{t(`providers.${p}`)}</option>
                ))}
              </Select>
            </FormField>
            <FormField label={t("model")} htmlFor={`${value.use}_model`}>
              <Input
                id={`${value.use}_model`}
                name={`${value.use}_model`}
                dir="ltr"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </FormField>
          </div>
          <FormField label={t("baseUrl")} htmlFor={`${value.use}_baseUrl`}>
            <Input
              id={`${value.use}_baseUrl`}
              name={`${value.use}_baseUrl`}
              dir="ltr"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </FormField>
          <FormField
            label={t("apiKey")}
            htmlFor={`${value.use}_apiKey`}
            hint={value.apiKeyMask ? t("apiKeyStored", { masked: value.apiKeyMask }) : t("apiKeyShared")}
          >
            <Input
              id={`${value.use}_apiKey`}
              name={`${value.use}_apiKey`}
              type="password"
              dir="ltr"
              autoComplete="off"
              placeholder={value.apiKeyMask || "sk-…"}
            />
          </FormField>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-1" disabled={testing} onClick={onTest}>
              <PlugZap className="size-4" />
              {testing ? t("testing") : t("testConnection")}
            </Button>
            {testMsg && <span className="text-sm text-success">{testMsg}</span>}
            {testErr && <span className="text-sm text-destructive">{testErr}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
