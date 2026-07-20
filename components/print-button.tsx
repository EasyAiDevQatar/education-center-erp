"use client";

import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  const t = useTranslations("common");
  return (
    <Button onClick={() => window.print()} className="gap-2 print:hidden">
      <Printer className="size-4" />
      {t("print")}
    </Button>
  );
}
