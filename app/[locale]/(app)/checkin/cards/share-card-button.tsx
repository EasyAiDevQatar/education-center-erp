"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MessageCircle, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { sendCheckinCode } from "./card-actions";

/**
 * Send a student's check-in code to their guardian.
 *
 * This used to open wa.me on the staff member's own phone and let them press
 * send, on the argument that a one-off human action should stay human. That
 * argument does not survive the centre having a WhatsApp number of its own:
 * the wa.me route sent the code from whoever happened to be at the desk, so
 * the family received their child's door code from a stranger's personal
 * number, and the centre had no record it was ever sent.
 *
 * It goes through EasyAiConnect now — from the centre, logged next to every
 * other message, and visible in Messages → الصادر.
 */
export function ShareCardButton({
  studentId,
  phone,
}: {
  studentId: string;
  phone: string | null;
}) {
  const t = useTranslations("checkin");
  const locale = useLocale();
  const [state, setState] = useState<"idle" | "sent" | "failed">("idle");
  const [reason, setReason] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!phone) {
    return <span className="no-print mt-1 text-[10px] text-muted-foreground">{t("noPhone")}</span>;
  }

  return (
    <button
      type="button"
      disabled={pending || state === "sent"}
      title={reason ?? undefined}
      onClick={() =>
        start(async () => {
          const res = await sendCheckinCode(locale, studentId);
          setState(res.ok ? "sent" : "failed");
          setReason(res.ok ? null : (res.error ?? null));
        })
      }
      className={cn(
        "no-print mt-1 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
        state === "sent"
          ? "border-[var(--success)] text-[var(--success)]"
          : state === "failed"
            ? "border-destructive text-destructive"
            : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {state === "sent" ? (
        <Check className="size-3" />
      ) : state === "failed" ? (
        <X className="size-3" />
      ) : (
        <MessageCircle className="size-3" />
      )}
      {state === "sent" ? t("shareSent") : state === "failed" ? t("shareFailed") : t("shareWhatsApp")}
    </button>
  );
}
