"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MessageCircle, Check, X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { sendStatement, sendDuesReminders } from "@/app/[locale]/(app)/messages/whatsapp-actions";

/**
 * One button, wherever something is worth sending.
 *
 * It reports what happened in place rather than through a toast that has gone
 * by the time you look up — "sent" and "not sent, here is why" are the two
 * things somebody pressing this needs, and a silent green flash is neither.
 */
export function SendStatementButton({
  kind,
  id,
  size = "sm",
}: {
  kind: "student" | "guardian" | "teacher";
  id: string;
  size?: "sm" | "default";
}) {
  const t = useTranslations("messages");
  const locale = useLocale();
  const [state, setState] = useState<"idle" | "sent" | "failed">("idle");
  const [reason, setReason] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      disabled={pending || state === "sent"}
      title={reason ?? undefined}
      onClick={() =>
        start(async () => {
          const res = await sendStatement(locale, kind, id);
          setState(res.ok ? "sent" : "failed");
          setReason(res.ok ? null : (res.error ?? null));
        })
      }
    >
      {state === "sent" ? (
        <Check className="me-1 size-4 text-[var(--success)]" />
      ) : state === "failed" ? (
        <X className="me-1 size-4 text-destructive" />
      ) : (
        <MessageCircle className="me-1 size-4" />
      )}
      {state === "sent" ? t("sent") : state === "failed" ? t("notSent") : t("sendStatement")}
    </Button>
  );
}

/**
 * Chase everybody who owes, on demand.
 *
 * The result is spelled out — sent, skipped as reminded recently, and the
 * families with no number at all. That last count is the one worth seeing:
 * those are the people the office has to actually ring.
 */
export function SendDuesRemindersButton() {
  const t = useTranslations("messages");
  const locale = useLocale();
  const router = useRouter();
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setSummary(null);
            setError(null);
            const res = await sendDuesReminders(locale);
            if (res.ok && res.run) {
              setSummary(
                t("duesResult", {
                  sent: res.run.sent,
                  skipped: res.run.skippedByCooldown,
                  unreachable: res.run.unreachable,
                }),
              );
              router.refresh();
            } else setError(res.error ?? "failed");
          })
        }
      >
        <MessageCircle className="me-1 size-4" />
        {pending ? t("sending") : t("remindDues")}
      </Button>
      {summary && <span className="text-xs text-muted-foreground">{summary}</span>}
      {error && (
        <span className="text-xs text-destructive">
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : error}
        </span>
      )}
    </div>
  );
}
