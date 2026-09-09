"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  printDoc,
  printFormat,
  printPageSize,
  type PrintFormat,
  type PrintOrientation,
} from "@/lib/print";

export function PrintButton({
  defaultFormat = "A4",
  formats = ["A4", "A5", "POS80"],
  orientation = "portrait",
  fileName,
}: {
  defaultFormat?: PrintFormat | string;
  formats?: PrintFormat[];
  orientation?: PrintOrientation;
  fileName?: string;
}) {
  const tc = useTranslations("common");
  const ts = useTranslations("settings");
  const selectId = useId();
  const [format, setFormat] = useState<PrintFormat>(() => {
    const preferred = printFormat(defaultFormat);
    return formats.includes(preferred) ? preferred : formats[0] ?? "A4";
  });

  function print() {
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>("[data-print-size-selectable]"),
    );
    const original = targets.map((node) => node.getAttribute("data-print"));
    for (const node of targets) node.setAttribute("data-print", format);
    try {
      printDoc({
        size: printPageSize(format, orientation),
        margin: format === "POS80" ? 3 : 12,
        fileName,
      });
    } finally {
      targets.forEach((node, index) => {
        const value = original[index];
        if (value === null) node.removeAttribute("data-print");
        else node.setAttribute("data-print", value);
      });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <label className="sr-only" htmlFor={selectId}>{tc("printFormat")}</label>
      <Select
        id={selectId}
        aria-label={tc("printFormat")}
        className="w-32"
        value={format}
        onChange={(event) => setFormat(event.target.value as PrintFormat)}
      >
        {formats.includes("A4") && <option value="A4">{ts("sizeA4")}</option>}
        {formats.includes("A5") && <option value="A5">{ts("sizeA5")}</option>}
        {formats.includes("POS80") && <option value="POS80">{ts("sizePos")}</option>}
      </Select>
      <Button onClick={print} className="gap-2">
        <Printer className="size-4" />
        {tc("print")}
      </Button>
    </div>
  );
}
