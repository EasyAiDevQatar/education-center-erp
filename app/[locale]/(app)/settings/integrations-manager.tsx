"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plug, CheckCircle2, XCircle, Send, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/crud/form-field";
import { cn } from "@/lib/utils";
import {
  saveIntegration,
  testIntegration,
  sendTestMessage,
  type IntegrationState,
} from "./integrations-actions";

export type ProviderFieldView = {
  key: string;
  labelKey: string;
  placeholder?: string;
  help?: string;
};

export type IntegrationView = {
  provider: string;
  label: string;
  docsUrl?: string;
  fields: ProviderFieldView[];
  enabled: boolean;
  baseUrl: string;
  /** Masked — the real key never reaches the browser. */
  apiKeyMask: string;
  hasKey: boolean;
  config: Record<string, string>;
  events: string[];
  audiences: string[];
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMsg: string | null;
};

const ALL_EVENTS = [
  "SESSION_BOOKED",
  "SESSION_RESCHEDULED",
  "SESSION_CANCELLED",
  "CHECKED_IN",
  "CHECKED_OUT",
  "PAYMENT_RECEIVED",
  "PAYOUT_PAID",
  "BALANCE_REMINDER",
] as const;
const ALL_AUDIENCES = ["TEACHER", "PARENT", "STUDENT"] as const;

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs transition-colors",
        on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
}

export function IntegrationsManager({ integrations }: { integrations: IntegrationView[] }) {
  return (
    <div className="space-y-4">
      {integrations.map((i) => (
        <IntegrationCard key={i.provider} data={i} />
      ))}
    </div>
  );
}

function IntegrationCard({ data }: { data: IntegrationView }) {
  const t = useTranslations("integrations");
  const tc = useTranslations("common");
  const te = useTranslations("integrationEvents");
  const locale = useLocale();

  const [enabled, setEnabled] = useState(data.enabled);
  const [baseUrl, setBaseUrl] = useState(data.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [config, setConfig] = useState<Record<string, string>>(data.config ?? {});
  const [events, setEvents] = useState<string[]>(data.events ?? []);
  const [audiences, setAudiences] = useState<string[]>(data.audiences ?? []);
  const [testTo, setTestTo] = useState("");

  const [pending, start] = useTransition();
  const [result, setResult] = useState<IntegrationState | null>(null);

  const toggleIn = (list: string[], set: (v: string[]) => void, key: string) =>
    set(list.includes(key) ? list.filter((x) => x !== key) : [...list, key]);

  function run(fn: () => Promise<IntegrationState>) {
    setResult(null);
    start(async () => setResult(await fn()));
  }

  const save = () =>
    run(() =>
      saveIntegration(locale, {
        provider: data.provider,
        enabled,
        baseUrl,
        apiKey,
        config,
        events: events as never,
        audiences: audiences as never,
      }),
    );

  return (
    <div className="rounded-lg border border-border p-4">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Plug className="size-4 text-muted-foreground" />
          <span className="font-semibold">{data.label}</span>
          <Badge variant={enabled ? "success" : "muted"}>
            {enabled ? tc("active") : tc("inactive")}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {data.lastTestAt && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs",
                data.lastTestOk ? "text-[var(--success)]" : "text-destructive",
              )}
            >
              {data.lastTestOk ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
              {data.lastTestOk ? t("testOk") : t("testFailed")}
            </span>
          )}
          <Toggle on={enabled} onChange={setEnabled} label={enabled ? t("disable") : t("enable")} />
        </div>
      </div>

      {/* Credentials */}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("baseUrl")} htmlFor={`${data.provider}-url`}>
          <Input
            id={`${data.provider}-url`}
            dir="ltr"
            placeholder="https://api.anychat.one"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </FormField>
        <FormField label={t("apiKey")} htmlFor={`${data.provider}-key`}>
          <Input
            id={`${data.provider}-key`}
            dir="ltr"
            type="password"
            placeholder={data.hasKey ? data.apiKeyMask : t("apiKeyPlaceholder")}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </FormField>
      </div>
      {data.hasKey && (
        <p className="mt-1 text-xs text-muted-foreground">{t("keepKeyHint")}</p>
      )}

      {/* Provider-specific fields */}
      {data.fields.length > 0 && (
        <details className="mt-3 rounded-md border border-border bg-muted/30 p-2">
          <summary className="cursor-pointer text-sm font-medium">{t("advanced")}</summary>
          <p className="mt-1 text-xs text-muted-foreground">{t("advancedHelp")}</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {data.fields.map((f) => (
              <FormField key={f.key} label={t(`fields.${f.labelKey}`)} htmlFor={`${data.provider}-${f.key}`}>
                <Input
                  id={`${data.provider}-${f.key}`}
                  dir="ltr"
                  placeholder={f.placeholder}
                  value={config[f.key] ?? ""}
                  onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
                />
              </FormField>
            ))}
          </div>
        </details>
      )}

      {/* Events */}
      <div className="mt-4">
        <p className="mb-1 text-xs font-semibold text-muted-foreground">{t("events")}</p>
        <div className="flex flex-wrap gap-1.5">
          {ALL_EVENTS.map((e) => (
            <Toggle
              key={e}
              on={events.includes(e)}
              onChange={() => toggleIn(events, setEvents, e)}
              label={te(e)}
            />
          ))}
        </div>
      </div>

      {/* Audiences */}
      <div className="mt-3">
        <p className="mb-1 text-xs font-semibold text-muted-foreground">{t("audiences")}</p>
        <div className="flex flex-wrap gap-1.5">
          {ALL_AUDIENCES.map((a) => (
            <Toggle
              key={a}
              on={audiences.includes(a)}
              onChange={() => toggleIn(audiences, setAudiences, a)}
              label={t(`audienceLabels.${a}`)}
            />
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Button size="sm" disabled={pending} onClick={save}>
          {pending ? tc("saving") : tc("save")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="gap-1"
          disabled={pending}
          onClick={() => run(() => testIntegration(locale, data.provider))}
        >
          <RefreshCw className="size-4" />
          {t("testConnection")}
        </Button>
        <div className="flex items-end gap-1">
          <Input
            dir="ltr"
            placeholder={t("testRecipient")}
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            className="h-9 w-44"
          />
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={pending || !testTo.trim()}
            onClick={() => run(() => sendTestMessage(locale, data.provider, testTo))}
          >
            <Send className="size-4" />
            {t("sendTest")}
          </Button>
        </div>
      </div>

      {/* Result */}
      {result && (
        <p
          className={cn(
            "mt-3 rounded-md px-3 py-2 text-sm",
            result.ok ? "bg-success/15 text-[var(--success)]" : "bg-destructive/10 text-destructive",
          )}
        >
          {result.ok ? t("success") : `${t("failed")}: ${result.error ?? ""}`}
          {result.message ? ` — ${result.message}` : ""}
        </p>
      )}
      {!result && data.lastTestMsg && (
        <p className="mt-3 truncate text-xs text-muted-foreground" dir="ltr">
          {data.lastTestMsg}
        </p>
      )}
    </div>
  );
}
