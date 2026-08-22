"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Eye, RotateCcw } from "lucide-react";
import { useRouter, Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { allowedVariables } from "@/lib/messages/render";
import { saveTemplate, previewTemplate } from "./template-actions";

export type TemplateRow = {
  event: string;
  locale: string;
  /** The centre's wording, or "" when it has not overridden the built-in. */
  body: string;
  /** What the message says today if `body` is empty — shown as the placeholder. */
  builtIn: string;
};

/**
 * The centre writes its own messages.
 *
 * One card per event, one box per language. Empty means "use the built-in
 * wording", which is shown greyed as the placeholder so it is obvious what
 * will be sent and obvious how to get back to it — clearing the box is the
 * undo, and it is easier to find than a reset button would be.
 */
export function TemplatesEditor({
  rows,
  audience,
}: {
  rows: TemplateRow[];
  /** "" is the fallback copy every audience falls back to. */
  audience: string;
}) {
  const t = useTranslations("messages");
  const ti = useTranslations("integrations");
  const te = useTranslations("integrationEvents");
  const events = [...new Set(rows.map((r) => r.event))];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("templatesIntro")}</p>

      {/* Whose wording. A teacher and a driver should never receive the same
          sentence, so the editor asks which reader before it asks what to say. */}
      <div className="flex flex-wrap gap-1.5">
        {["PARENT", "STUDENT", "TEACHER", "DRIVER", ""].map((a) => (
          <Link
            key={a || "default"}
            href={`/messages?tab=templates&audience=${a}`}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition",
              a === audience
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted",
            )}
          >
            {a ? ti(`audienceLabels.${a}`) : t("fallbackCopy")}
          </Link>
        ))}
      </div>
      {events.map((event) => (
        <EventCard
          key={event}
          event={event}
          audience={audience}
          label={te.has(event) ? te(event) : event}
          rows={rows.filter((r) => r.event === event)}
        />
      ))}
    </div>
  );
}

function EventCard({
  event,
  audience,
  label,
  rows,
}: {
  event: string;
  audience: string;
  label: string;
  rows: TemplateRow[];
}) {
  const t = useTranslations("messages");
  const variables = allowedVariables(event);

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-semibold">{label}</span>
        {rows.some((r) => r.body) && <Badge variant="success">{t("customised")}</Badge>}
      </div>

      {/* The variables this event carries. Clicking one inserts it — typing
          {{invoive}} by hand is the mistake this is here to prevent. */}
      <div className="mb-3 flex flex-wrap gap-1">
        {variables.map((v) => (
          <code
            key={v}
            className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
          >{`{{${v}}}`}</code>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((r) => (
          <LocaleBox key={r.locale} event={event} audience={audience} row={r} />
        ))}
      </div>
    </div>
  );
}

function LocaleBox({
  event,
  audience,
  row,
}: {
  event: string;
  audience: string;
  row: TemplateRow;
}) {
  const t = useTranslations("messages");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [body, setBody] = useState(row.body);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<{ code: string; detail?: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      setSaved(false);
      await fn();
    });

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">
        {row.locale === "ar" ? t("arabic") : t("english")}
      </label>
      <textarea
        rows={3}
        dir={row.locale === "ar" ? "rtl" : "ltr"}
        // The built-in as placeholder: what gets sent when this is empty.
        placeholder={row.builtIn}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      {error && (
        <p className="mt-1 text-xs text-destructive">
          {t.has(`errors.${error.code}`) ? t(`errors.${error.code}`) : error.code}
          {error.detail ? `: ${error.detail}` : ""}
        </p>
      )}
      {saved && <p className="mt-1 text-xs text-[var(--success)]">{tc("saved")}</p>}
      {preview !== null && (
        <p className="mt-1 rounded-md bg-muted/60 p-2 text-xs" dir="auto">
          {preview}
        </p>
      )}
      <div className="mt-1 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const res = await saveTemplate(locale, {
                event: event as never,
                audience: audience as never,
                locale: row.locale as "ar" | "en",
                body,
              });
              if (res.ok) {
                setSaved(true);
                router.refresh();
              } else setError({ code: res.error ?? "invalid", detail: res.detail });
            })
          }
        >
          {pending ? tc("saving") : tc("save")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || !body}
          onClick={() =>
            run(async () => {
              const res = await previewTemplate(event, body);
              if (res.ok) setPreview(res.text ?? "");
              else setError({ code: res.error ?? "invalid", detail: res.detail });
            })
          }
        >
          <Eye className="me-1 size-3.5" />
          {t("preview")}
        </Button>
        {row.body && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            title={t("resetHint")}
            onClick={() =>
              run(async () => {
                setBody("");
                await saveTemplate(locale, {
                  event: event as never,
                  audience: audience as never,
                  locale: row.locale as "ar" | "en",
                  body: "",
                });
                router.refresh();
              })
            }
          >
            <RotateCcw className="me-1 size-3.5" />
            {t("reset")}
          </Button>
        )}
      </div>
    </div>
  );
}
