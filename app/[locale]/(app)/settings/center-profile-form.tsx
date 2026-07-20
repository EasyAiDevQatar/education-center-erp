"use client";

import { useLocale, useTranslations } from "next-intl";
import { SectionForm } from "@/components/crud/section-form";
import { FormField } from "@/components/crud/form-field";
import { Input } from "@/components/ui/input";
import { saveCenterSettings } from "./actions";

export function CenterProfileForm({
  values,
}: {
  values: { centerName: string; currency: string; receiptFooter: string };
}) {
  const t = useTranslations("settings");
  const locale = useLocale();
  return (
    <SectionForm action={saveCenterSettings.bind(null, locale)}>
      <FormField label={t("centerName")} htmlFor="centerName">
        <Input id="centerName" name="centerName" defaultValue={values.centerName} />
      </FormField>
      <FormField label={t("currency")} htmlFor="currency">
        <Input id="currency" name="currency" dir="ltr" defaultValue={values.currency} className="w-32" />
      </FormField>
      <FormField label="Receipt footer" htmlFor="receiptFooter">
        <Input id="receiptFooter" name="receiptFooter" defaultValue={values.receiptFooter} />
      </FormField>
    </SectionForm>
  );
}
