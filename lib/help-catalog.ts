/**
 * The Help centre's information architecture. Copy stays in the locale files;
 * this catalog keeps routes, ordering and rollout status identical in Arabic
 * and English.
 */
export const HELP_CATEGORIES = [
  "gettingStarted",
  "dailyOperations",
  "people",
  "finance",
  "transport",
  "hr",
  "administration",
  "reportsAi",
] as const;

export type HelpCategoryKey = (typeof HELP_CATEGORIES)[number];

export const HELP_ARTICLES = [
  {
    slug: "activate-transport",
    category: "transport",
    titleKey: "activateTransport",
    descriptionKey: "activateTransportDescription",
    published: true,
  },
] as const;

export type HelpArticle = (typeof HELP_ARTICLES)[number];

export function findHelpArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}
