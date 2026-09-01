"use client";

import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Bus,
  CalendarDays,
  ChartNoAxesCombined,
  CircleHelp,
  Landmark,
  Search,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type HelpCategoryView = {
  key: string;
  title: string;
  description: string;
  status: string;
  publishedCount: number;
};

export type HelpArticleView = {
  slug: string;
  category: string;
  title: string;
  description: string;
  readTime: string;
};

const ICONS: Record<string, LucideIcon> = {
  gettingStarted: BookOpen,
  dailyOperations: CalendarDays,
  people: Users,
  finance: Landmark,
  transport: Bus,
  hr: Users,
  administration: Settings,
  reportsAi: ChartNoAxesCombined,
};

export function HelpCenterClient({
  categories,
  articles,
  labels,
}: {
  categories: HelpCategoryView[];
  articles: HelpArticleView[];
  labels: {
    searchPlaceholder: string;
    available: string;
    planned: string;
    noResults: string;
    noResultsHint: string;
    openGuide: string;
    featured: string;
  };
}) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase();
  const visibleCategories = useMemo(
    () =>
      categories.filter((category) => {
        if (!normalized) return true;
        const categoryMatch = `${category.title} ${category.description}`
          .toLocaleLowerCase()
          .includes(normalized);
        const articleMatch = articles.some(
          (article) =>
            article.category === category.key &&
            `${article.title} ${article.description}`.toLocaleLowerCase().includes(normalized),
        );
        return categoryMatch || articleMatch;
      }),
    [articles, categories, normalized],
  );

  const featured = articles[0];

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-cyan-700 px-5 py-8 text-primary-foreground shadow-sm sm:px-10 sm:py-11">
        <div aria-hidden="true" className="absolute -end-12 -top-16 size-52 rounded-full bg-white/10" />
        <div aria-hidden="true" className="absolute -bottom-24 start-1/3 size-56 rounded-full bg-white/10" />
        <div className="relative mx-auto max-w-2xl text-center">
          <CircleHelp className="mx-auto mb-3 size-9" />
          <div className="relative mt-5">
            <Search className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={labels.searchPlaceholder}
              aria-label={labels.searchPlaceholder}
              className="h-13 w-full rounded-xl border border-white/30 bg-white ps-12 pe-4 text-base text-slate-950 shadow-lg outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-white/70"
            />
          </div>
        </div>
      </div>

      {!normalized && featured && (
        <section aria-labelledby="featured-guide" className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Sparkles className="size-4" />
            <span id="featured-guide">{labels.featured}</span>
          </div>
          <Link href={`/help/${featured.slug}`} className="group block">
            <Card className="border-primary/30 bg-primary/[0.035] p-5 transition hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-4">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                    <Bus className="size-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold group-hover:text-primary">{featured.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{featured.description}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{featured.readTime}</p>
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-primary">
                  {labels.openGuide}
                  <ArrowRight className="size-4 rtl:rotate-180" />
                </span>
              </div>
            </Card>
          </Link>
        </section>
      )}

      {visibleCategories.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleCategories.map((category) => {
            const Icon = ICONS[category.key] ?? BookOpen;
            const live = category.publishedCount > 0;
            const matchingArticle = articles.find(
              (article) => article.category === category.key,
            );
            const content = (
              <Card
                className={cn(
                  "h-full p-5 transition",
                  live && "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-accent text-primary">
                    <Icon className="size-5" />
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium",
                      live
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {live ? labels.available : labels.planned}
                  </span>
                </div>
                <h2 className="mt-4 font-semibold">{category.title}</h2>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  {category.description}
                </p>
                {matchingArticle && (
                  <p className="mt-4 text-sm font-medium text-primary">{matchingArticle.title}</p>
                )}
              </Card>
            );
            return matchingArticle ? (
              <Link key={category.key} href={`/help/${matchingArticle.slug}`}>
                {content}
              </Link>
            ) : (
              <div key={category.key}>{content}</div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <Search className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-3 font-semibold">{labels.noResults}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{labels.noResultsHint}</p>
        </div>
      )}
    </div>
  );
}
