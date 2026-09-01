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
    slug: "quick-start-checklist",
    category: "gettingStarted",
    titleKey: "quickStart",
    descriptionKey: "quickStartDescription",
    readTime: 7,
    published: true,
  },
  {
    slug: "dashboard-navigation",
    category: "gettingStarted",
    titleKey: "dashboardNavigation",
    descriptionKey: "dashboardNavigationDescription",
    readTime: 6,
    published: true,
  },
  {
    slug: "activate-transport",
    category: "transport",
    titleKey: "activateTransport",
    descriptionKey: "activateTransportDescription",
    readTime: 8,
    published: true,
  },
] as const;

export type HelpArticle = (typeof HELP_ARTICLES)[number];

export function findHelpArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}
