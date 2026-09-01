import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { HelpCenterClient } from "@/components/help/help-center-client";
import { HELP_ARTICLES, HELP_CATEGORIES } from "@/lib/help-catalog";

export default async function HelpCenterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("help");

  const categories = HELP_CATEGORIES.map((key) => ({
    key,
    title: t(`categories.${key}.title`),
    description: t(`categories.${key}.description`),
    status: HELP_ARTICLES.some((article) => article.category === key && article.published)
      ? t("available")
      : t("planned"),
    publishedCount: HELP_ARTICLES.filter(
      (article) => article.category === key && article.published,
    ).length,
  }));
  const articles = HELP_ARTICLES.filter((article) => article.published).map((article) => ({
    slug: article.slug,
    category: article.category,
    title: t(`articles.${article.titleKey}.title`),
    description: t(`articles.${article.descriptionKey}`),
    readTime: t("readTime", { minutes: 4 }),
  }));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <HelpCenterClient
        categories={categories}
        articles={articles}
        labels={{
          searchPlaceholder: t("searchPlaceholder"),
          available: t("available"),
          planned: t("planned"),
          noResults: t("noResults"),
          noResultsHint: t("noResultsHint"),
          openGuide: t("openGuide"),
          featured: t("featured"),
        }}
      />
    </div>
  );
}
