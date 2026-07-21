import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { CenterHome } from "./center-home";
import { ErpFeatures } from "./erp-features";

/**
 * Always rendered per-request: the page body is decided by live settings
 * (publicHome, hero texts) and DB data. Prerendering would bake the choice
 * into the build and also break builds run without a database.
 */
export const dynamic = "force-dynamic";

/**
 * The root URL. What it shows is the centre's choice, stored in the
 * `publicHome` setting:
 *   ERP    (default) — the EDU ERP features page
 *   CENTER           — the centre's public homepage
 *   LOGIN            — straight to the login page (the pre-public behaviour)
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site" });
  return { title: t("metaRootTitle"), description: t("metaRootDescription") };
}

export default async function PublicRootPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const setting = await db.setting.findUnique({ where: { key: "publicHome" } });
  const mode = setting?.value ?? "ERP";

  if (mode === "LOGIN") redirect({ href: "/login", locale });
  if (mode === "CENTER") return <CenterHome locale={locale} />;
  return <ErpFeatures />;
}
