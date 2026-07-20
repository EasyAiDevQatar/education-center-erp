"use client";

import { useTransition, useState } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { confirmOwnSession } from "../actions";

/** Teacher-side "I taught this" button; enabled only when the centre allows it. */
export function ConfirmOwnSessions({
  sessionId,
  locale,
}: {
  sessionId: string;
  locale: string;
}) {
  const t = useTranslations("portal");
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  const router = useRouter();

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{t("confirmFailed")}</span>}
      <Button
        size="sm"
        className="gap-1"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await confirmOwnSession(locale, sessionId);
            if (res.ok) router.refresh();
            else setError(true);
          })
        }
      >
        <Check className="size-3.5" />
        {t("confirmTaught")}
      </Button>
    </span>
  );
}
