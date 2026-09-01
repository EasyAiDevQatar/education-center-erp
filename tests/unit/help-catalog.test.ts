import { describe, expect, it } from "vitest";
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  findHelpArticle,
} from "@/lib/help-catalog";

describe("Help center catalog", () => {
  it("keeps category and article routes unique", () => {
    expect(new Set(HELP_CATEGORIES).size).toBe(HELP_CATEGORIES.length);
    expect(new Set(HELP_ARTICLES.map((article) => article.slug)).size).toBe(
      HELP_ARTICLES.length,
    );
  });

  it("publishes the ordered Start Here guides and keeps Transport available", () => {
    expect(HELP_ARTICLES[0]).toMatchObject({
      slug: "quick-start-checklist",
      category: "gettingStarted",
      published: true,
    });
    expect(findHelpArticle("activate-transport")).toMatchObject({
      category: "transport",
      published: true,
    });
    expect(HELP_ARTICLES[1]).toMatchObject({
      slug: "dashboard-navigation",
      category: "gettingStarted",
      published: true,
    });
    expect(HELP_ARTICLES.filter((article) => article.published)).toHaveLength(3);
  });

  it("does not resolve an unknown article", () => {
    expect(findHelpArticle("missing-guide")).toBeUndefined();
  });
});
