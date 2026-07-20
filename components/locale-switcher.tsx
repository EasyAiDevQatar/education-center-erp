"use client";

import { useLocale } from "next-intl";
import { useParams } from "next/navigation";
import { useTransition } from "react";
import { Languages } from "lucide-react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

/** Toggles between Arabic and English, preserving the current path. */
export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const next = locale === "ar" ? "en" : "ar";

  function switchTo() {
    startTransition(() => {
      // @ts-expect-error -- params are passed straight through for dynamic routes
      router.replace({ pathname, params }, { locale: next });
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={switchTo}
      disabled={pending}
      className="gap-2"
    >
      <Languages className="size-4" />
      {next === "ar" ? "العربية" : "English"}
    </Button>
  );
}
