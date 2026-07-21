import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { CenterHome } from "../center-home";

/**
 * Always rendered per-request: the page body is decided by live settings
 * (publicHome, hero texts) and DB data. Prerendering would bake the choice
 * into the build and also break builds run without a database.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site" });
  const name = await db.setting.findUnique({ where: { key: "centerName" } });
  return {
    title: name?.value || t("metaHomeTitle"),
    description: t("heroTextDefault"),
  };
}

export default async function CenterHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <CenterHome locale={locale} />;
}
