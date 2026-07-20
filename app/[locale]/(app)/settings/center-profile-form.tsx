"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ImageUp, Trash2 } from "lucide-react";
import { SectionForm } from "@/components/crud/section-form";
import { FormField } from "@/components/crud/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { saveCenterSettings } from "./actions";

export type CenterValues = {
  centerName: string;
  currency: string;
  receiptFooter: string;
  centerAddress: string;
  centerPhone: string;
  centerTaxNo: string;
  receiptSize: string;
  statementFooter: string;
  centerLogo: string;
};

/** Downscale a picked image client-side so the stored data URL stays small. */
async function toDataUrl(file: File, maxSide = 320): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/png");
}

export function CenterProfileForm({ values }: { values: CenterValues }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();

  const [logo, setLogo] = useState(values.centerLogo);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(file?: File) {
    if (!file) return;
    setLogo(await toDataUrl(file));
  }

  return (
    <SectionForm action={saveCenterSettings.bind(null, locale)}>
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <ImageUp className="size-5 text-muted-foreground" />
          )}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("logo")}</p>
          <div className="flex gap-1.5">
            <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              {t("uploadLogo")}
            </Button>
            {logo && (
              <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => setLogo("")}>
                <Trash2 className="size-3.5" />
                {tc("delete")}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t("logoHint")}</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0])}
        />
        {/* Sentinel distinguishes "cleared" from "unchanged". */}
        <input type="hidden" name="centerLogo" value={logo || (values.centerLogo ? "__CLEAR__" : "")} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("centerName")} htmlFor="centerName">
          <Input id="centerName" name="centerName" defaultValue={values.centerName} />
        </FormField>
        <FormField label={t("currency")} htmlFor="currency">
          <Input id="currency" name="currency" dir="ltr" defaultValue={values.currency} />
        </FormField>
        <FormField label={tc("phone")} htmlFor="centerPhone">
          <Input id="centerPhone" name="centerPhone" dir="ltr" defaultValue={values.centerPhone} />
        </FormField>
        <FormField label={t("taxNo")} htmlFor="centerTaxNo">
          <Input id="centerTaxNo" name="centerTaxNo" dir="ltr" defaultValue={values.centerTaxNo} />
        </FormField>
      </div>

      <FormField label={t("address")} htmlFor="centerAddress">
        <Input id="centerAddress" name="centerAddress" defaultValue={values.centerAddress} />
      </FormField>

      <FormField label={t("receiptSize")} htmlFor="receiptSize">
        <Select id="receiptSize" name="receiptSize" defaultValue={values.receiptSize || "A4"}>
          <option value="A4">{t("sizeA4")}</option>
          <option value="POS80">{t("sizePos")}</option>
        </Select>
      </FormField>

      <FormField label={t("receiptFooter")} htmlFor="receiptFooter">
        <Input id="receiptFooter" name="receiptFooter" defaultValue={values.receiptFooter} />
      </FormField>
      <FormField label={t("statementFooter")} htmlFor="statementFooter">
        <Input id="statementFooter" name="statementFooter" defaultValue={values.statementFooter} />
      </FormField>
    </SectionForm>
  );
}
