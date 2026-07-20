"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Client-side search over already-loaded table rows.
 *
 * Pairs with `usePagination`: search first, then paginate the result, so the
 * pager reflects matches rather than the full set. Matching is a case- and
 * diacritic-insensitive substring test across the fields the caller names.
 */
export function useTableSearch<T>(
  items: T[],
  fields: (item: T) => (string | null | undefined)[],
) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return items;
    return items.filter((it) =>
      fields(it).some((f) => (f ? normalize(f).includes(q) : false)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query]);

  return { query, setQuery, filtered, isFiltering: query.trim().length > 0 };
}

/**
 * Fold Arabic diacritics and alef/ya variants so "احمد" finds "أحمد".
 *
 * Staff type quickly and rarely bother with hamza, so an exact match would
 * make the box feel broken on the majority of Arabic names.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, "") // harakat
    .replace(/[آأإٱ]/g, "ا") // آأإٱ → ا
    .replace(/ة/g, "ه") // ة → ه
    .replace(/[ى]/g, "ي") // ى → ي
    .replace(/ـ/g, "") // tatweel
    .trim();
}

/** Search box for the top of a table page. */
export function TableSearch({
  value,
  onChange,
  placeholder,
  resultCount,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Shown next to the box while a query is active. */
  resultCount?: number;
  className?: string;
}) {
  const tc = useTranslations("common");
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 size-4 text-muted-foreground start-2.5" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? tc("searchPlaceholder")}
          aria-label={placeholder ?? tc("searchPlaceholder")}
          className="h-9 w-full rounded-md border border-input bg-background ps-8 pe-8 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {value && (
          <button
            type="button"
            aria-label={tc("clear")}
            onClick={() => onChange("")}
            className="absolute top-1/2 -translate-y-1/2 end-2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {value.trim() && resultCount !== undefined && (
        <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
          {tc("resultsCount", { n: resultCount })}
        </span>
      )}
    </div>
  );
}
