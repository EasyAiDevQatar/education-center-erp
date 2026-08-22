"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ConnectGate, ConnectUnlockedBar } from "./connect-gate";
import { Plug, CheckCircle2, XCircle, Send, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/crud/form-field";
import { cn } from "@/lib/utils";
import {
  saveIntegration,
  testIntegration,
  sendTestMessage,
  rotateWebhookSecret,
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
  /** Null until issued. The URL is only meaningful once it exists. */
  webhookSecret: string | null;
};

/** One message somebody sent TO the centre. */
export type InboundRow = {
  id: string;
  at: string;
  phone: string | null;
  body: string;
  who: string | null;
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
  "SESSION_REMINDER",
  "PACKAGE_LOW",
] as const;
const ALL_AUDIENCES = ["TEACHER", "PARENT", "STUDENT", "DRIVER"] as const;

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

export function IntegrationsManager({
  integrations,
  gate,
  inbound,
  origin,
}: {
  integrations: IntegrationView[];
  gate: { isSet: boolean; isOpen: boolean };
  inbound: InboundRow[];
  origin: string;
}) {
  // Locked is the default view, not a redirect: the person is already an
  // administrator and simply needs to say the word again.
  if (!gate.isSet) return <ConnectGate isSet={false} />;
  if (!gate.isOpen) return <ConnectGate isSet />;

  return (
    <div className="space-y-4">
      <ConnectUnlockedBar />
      {integrations.map((i) => (
        <IntegrationCard key={i.provider} data={i} origin={origin} />
      ))}
      <InboundLog rows={inbound} />
    </div>
  );
}

/** Replies from families, drivers and teachers — recorded, never acted on. */
function InboundLog({ rows }: { rows: InboundRow[] }) {
  const t = useTranslations("integrations");
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="mb-1 font-semibold">{t("inboundTitle")}</p>
      <p className="mb-3 text-xs text-muted-foreground">{t("inboundIntro")}</p>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("inboundEmpty")}</p>
      ) : (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td
                    className="whitespace-nowrap py-2 pe-3 align-top text-xs text-muted-foreground tabular-nums"
                    dir="ltr"
                  >
                    {r.at}
                  </td>
                  <td className="py-2 pe-3 align-top">
                    <span className="font-medium">{r.who ?? t("inboundUnknown")}</span>
                    {r.phone && (
                      <span className="ms-2 text-xs text-muted-foreground" dir="ltr">
                        {r.phone}
                      </span>
                    )}
                  </td>
                  <td className="py-2 align-top" dir="auto">
                    {r.body}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function IntegrationCard({ data, origin }: { data: IntegrationView; origin: string }) {
  const t = useTranslations("integrations");
  const tc = useTranslations("common");
  const te = useTranslations("integrationEvents");
  const locale = useLocale();

  const [enabled, setEnabled] = useState(data.enabled);
  // The host is fixed server-side now; the stored value rides along untouched
  // so an older row is not rewritten to null by a save from this screen.
  const baseUrl = data.baseUrl;
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
        <FormField label={t("apiKey")} htmlFor={`${data.provider}-key`}>
          <PasswordInput
            id={`${data.provider}-key`}
            dir="ltr"
            placeholder={data.hasKey ? data.apiKeyMask : t("apiKeyPlaceholder")}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </FormField>
      </div>
      {data.hasKey && (
        <p className="mt-1 text-xs text-muted-foreground">{t("keepKeyHint")}</p>
      )}

      {/* Inbound. The URL is the credential, which is why it is issued rather
          than typed, and why replacing it is described as revoking. */}
      <div className="mt-4 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">{t("webhookTitle")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("webhookIntro")}</p>
        {data.webhookSecret ? (
          <>
            <p className="mt-2 break-all rounded-md bg-muted/60 p-2 font-mono text-xs" dir="ltr">
              {origin}/api/connect/{data.webhookSecret}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{t("webhookRotateHint")}</p>
          </>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">{t("webhookNone")}</p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={pending}
          onClick={() =>
            start(async () => setResult(await rotateWebhookSecret(locale, data.provider)))
          }
        >
          {data.webhookSecret ? t("webhookRotate") : t("webhookIssue")}
        </Button>
      </div>

      {/* Provider-specific fields. These used to sit behind an "advanced (API
          paths)" fold, because they were endpoint guesses nobody was expected
          to touch. What remains is the channel — required, and useless hidden. */}
      {data.fields.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {data.fields.map((f) => (
            <FormField
              key={f.key}
              label={t(`fields.${f.labelKey}`)}
              htmlFor={`${data.provider}-${f.key}`}
              hint={f.help ? t(`fields.${f.help}`) : undefined}
            >
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
