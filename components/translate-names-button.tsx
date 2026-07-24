"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Languages } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { translateMissingNames } from "@/app/[locale]/(app)/translate-actions";
import type { TranslatableEntity } from "@/lib/ai/translate-names";

/**
 * "Translate missing names (AI)" — shown on the students/teachers/guardians
 * lists when the AI module is enabled. Fills only empty `nameEn` fields.
 */
export function TranslateNamesButton({ entity }: { entity: TranslatableEntity }) {
  const t = useTranslations("ai");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function run() {
    setResult(null);
    start(async () => {
      const r = await translateMissingNames(locale, entity);
      if ("error" in r && r.error) setResult(t("translateFailed"));
      else if ("translated" in r) {
        setResult(t("translateDone", { n: r.translated ?? 0, remaining: r.remaining ?? 0 }));
        router.refresh();
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" className="gap-1" disabled={pending} onClick={run}>
        <Languages className="size-4" />
        {pending ? t("translating") : t("translateMissing")}
      </Button>
      {result && <span className="text-xs text-muted-foreground">{result}</span>}
    </span>
  );
}
