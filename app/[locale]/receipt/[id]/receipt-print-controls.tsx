"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { printDoc } from "@/lib/print";

export type ReceiptFormat = "POS80" | "A4" | "A5";

export function ReceiptPrintControls({ format }: { format: ReceiptFormat }) {
  const t = useTranslations("payments");
  const ts = useTranslations("settings");
  const tc = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();

  function select(next: ReceiptFormat) {
    router.replace(`${pathname}?size=${next}`);
  }

  function print() {
    printDoc({
      size: format === "POS80" ? "80mm auto" : `${format} portrait`,
      margin: format === "POS80" ? 3 : 12,
    });
  }

  return (
    <div className="no-print mb-4 flex flex-wrap items-center justify-end gap-2">
      <label htmlFor="receipt-format" className="text-sm text-muted-foreground">{t("printFormat")}</label>
      <Select
        id="receipt-format"
        className="w-36"
        value={format}
        onChange={(event) => select(event.target.value as ReceiptFormat)}
      >
        <option value="POS80">{ts("sizePos")}</option>
        <option value="A4">{ts("sizeA4")}</option>
        <option value="A5">{ts("sizeA5")}</option>
      </Select>
      <Button onClick={print} className="gap-2">
        <Printer className="size-4" />
        {tc("print")}
      </Button>
    </div>
  );
}
