"use client";

import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Open a document's stored scan.
 *
 * The centre keeps scans in its own Drive/share rather than in this database
 * (a passport image in every nightly pg_dump is a liability), so what we hold
 * is a link. When there is none we say so plainly instead of rendering a button
 * that does nothing — the previous dialog looked clickable and was not.
 */
export function DocumentLink({ fileUrl }: { fileUrl: string | null }) {
  const t = useTranslations("hr");

  if (!fileUrl) {
    return <span className="text-xs text-muted-foreground">{t("noFile")}</span>;
  }

  return (
    <a href={fileUrl} target="_blank" rel="noreferrer noopener">
      <Button type="button" variant="outline" size="sm" className="gap-1">
        <ExternalLink className="size-3.5" />
        {t("openFile")}
      </Button>
    </a>
  );
}
