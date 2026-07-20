"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Printer, KeyRound, ArrowRight, ArrowLeft } from "lucide-react";
import { useRouter, Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { printDoc } from "@/lib/print";
import { ensureQrTokens } from "../actions";

/** Print / generate controls for the QR card sheet. */
export function CardsToolbar({ missing }: { missing: number }) {
  const t = useTranslations("checkin");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="no-print flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
      <Link href="/checkin">
        <Button variant="ghost" size="sm" className="gap-1">
          <ArrowRight className="size-4 rtl:hidden" />
          <ArrowLeft className="hidden size-4 rtl:block" />
          {t("backToRoster")}
        </Button>
      </Link>

      {missing > 0 && (
        <span className="text-sm text-muted-foreground">{t("missingCards", { n: missing })}</span>
      )}

      <div className="ms-auto flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="gap-1"
          disabled={pending || missing === 0}
          onClick={() =>
            start(async () => {
              await ensureQrTokens(locale);
              router.refresh();
            })
          }
        >
          <KeyRound className="size-4" />
          {pending ? tc("saving") : t("generateCards")}
        </Button>
        <Button size="sm" className="gap-1" onClick={() => printDoc("A4 portrait")}>
          <Printer className="size-4" />
          {tc("print")}
        </Button>
      </div>
    </div>
  );
}
