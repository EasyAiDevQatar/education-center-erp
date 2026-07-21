"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/crud/form-field";
import { saveSiteSettings } from "./site-actions";

export type SiteSettingsValues = {
  publicHome: string;
  siteHeroTitleAr: string;
  siteHeroTitleEn: string;
  siteHeroTextAr: string;
  siteHeroTextEn: string;
  siteAboutAr: string;
  siteAboutEn: string;
  siteYears: string;
  siteStudents: string;
  siteSuccessRate: string;
  siteBranches: string;
  siteWhatsApp: string;
};

export function SiteSettings({ values }: { values: SiteSettingsValues }) {
  const t = useTranslations("siteSettings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setMsg(null);
    setErr(null);
    start(async () => {
      const r = await saveSiteSettings(locale, {}, fd);
      if (r.ok) {
        setMsg(tc("saved"));
        router.refresh();
      } else setErr(r.error ?? "invalid");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("publicHome")} htmlFor="site-home" hint={t("publicHomeHint")}>
          <Select id="site-home" name="publicHome" defaultValue={values.publicHome || "ERP"}>
            <option value="ERP">{t("homeErp")}</option>
            <option value="CENTER">{t("homeCenter")}</option>
            <option value="LOGIN">{t("homeLogin")}</option>
          </Select>
        </FormField>
        <FormField label={t("whatsapp")} htmlFor="site-wa" hint={t("whatsappHint")}>
          <Input id="site-wa" name="siteWhatsApp" dir="ltr" placeholder="974…" defaultValue={values.siteWhatsApp} />
        </FormField>
      </div>

      <p className="border-b border-border pb-1 pt-2 text-xs font-semibold text-muted-foreground">
        {t("secHero")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("heroTitleAr")} htmlFor="site-htA">
          <Input id="site-htA" name="siteHeroTitleAr" defaultValue={values.siteHeroTitleAr} />
        </FormField>
        <FormField label={t("heroTitleEn")} htmlFor="site-htE">
          <Input id="site-htE" name="siteHeroTitleEn" dir="ltr" defaultValue={values.siteHeroTitleEn} />
        </FormField>
        <FormField label={t("heroTextAr")} htmlFor="site-hxA">
          <Input id="site-hxA" name="siteHeroTextAr" defaultValue={values.siteHeroTextAr} />
        </FormField>
        <FormField label={t("heroTextEn")} htmlFor="site-hxE">
          <Input id="site-hxE" name="siteHeroTextEn" dir="ltr" defaultValue={values.siteHeroTextEn} />
        </FormField>
        <FormField label={t("aboutAr")} htmlFor="site-abA">
          <Input id="site-abA" name="siteAboutAr" defaultValue={values.siteAboutAr} />
        </FormField>
        <FormField label={t("aboutEn")} htmlFor="site-abE">
          <Input id="site-abE" name="siteAboutEn" dir="ltr" defaultValue={values.siteAboutEn} />
        </FormField>
      </div>

      <p className="border-b border-border pb-1 pt-2 text-xs font-semibold text-muted-foreground">
        {t("secStats")}
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        <FormField label={t("statYears")} htmlFor="site-y">
          <Input id="site-y" name="siteYears" dir="ltr" placeholder="15+" defaultValue={values.siteYears} />
        </FormField>
        <FormField label={t("statStudents")} htmlFor="site-st">
          <Input id="site-st" name="siteStudents" dir="ltr" placeholder="1000+" defaultValue={values.siteStudents} />
        </FormField>
        <FormField label={t("statSuccess")} htmlFor="site-su">
          <Input id="site-su" name="siteSuccessRate" dir="ltr" placeholder="95%" defaultValue={values.siteSuccessRate} />
        </FormField>
        <FormField label={t("statBranches")} htmlFor="site-b">
          <Input id="site-b" name="siteBranches" dir="ltr" placeholder="3" defaultValue={values.siteBranches} />
        </FormField>
      </div>

      {msg && <p className="text-sm text-[var(--success)]">{msg}</p>}
      {err && <p className="text-sm text-destructive">{tc("required")}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? tc("saving") : tc("save")}
        </Button>
        <a href={`/${locale}/home`} target="_blank" rel="noopener noreferrer">
          <Button type="button" variant="outline" className="gap-1">
            <ExternalLink className="size-4" />
            {t("preview")}
          </Button>
        </a>
      </div>
    </form>
  );
}
