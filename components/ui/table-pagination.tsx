"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const PAGE_SIZES = [20, 50, 100] as const;
export type PageSize = number | "all";

/** Client-side pagination state for an already-loaded list. */
export function usePagination<T>(items: T[], initialSize: PageSize = 20) {
  const [pageSize, setPageSizeState] = useState<PageSize>(initialSize);
  const [page, setPage] = useState(1);

  const total = items.length;
  const size = pageSize === "all" ? Math.max(total, 1) : pageSize;
  const pageCount = Math.max(1, Math.ceil(total / size));

  // Keep the current page in range when the list or page size changes.
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const setPageSize = (s: PageSize) => {
    setPageSizeState(s);
    setPage(1);
  };

  const start = (page - 1) * size;
  const pageItems = useMemo(
    () => (pageSize === "all" ? items : items.slice(start, start + size)),
    [items, pageSize, start, size],
  );

  return { pageItems, page, setPage, pageSize, setPageSize, total, pageCount, start };
}

export type PaginationProps = {
  page: number;
  setPage: (p: number) => void;
  pageSize: PageSize;
  setPageSize: (s: PageSize) => void;
  total: number;
  pageCount: number;
  start: number;
  className?: string;
};

/** Footer control: "Showing X–Y of Z", rows-per-page (20/50/100/All), pager. */
export function TablePagination({
  page,
  setPage,
  pageSize,
  setPageSize,
  total,
  pageCount,
  start,
  className,
}: PaginationProps) {
  const t = useTranslations("common");
  if (total === 0) return null;

  const from = start + 1;
  const to = pageSize === "all" ? total : Math.min(start + (pageSize as number), total);

  // Compact page window around the current page.
  const pages: (number | "…")[] = [];
  const push = (n: number | "…") => pages.push(n);
  if (pageCount <= 7) {
    for (let i = 1; i <= pageCount; i++) push(i);
  } else {
    push(1);
    if (page > 3) push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(pageCount - 1, page + 1); i++) push(i);
    if (page < pageCount - 2) push("…");
    push(pageCount);
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 text-sm",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{t("rowsPerPage")}</span>
        <Select
          aria-label={t("rowsPerPage")}
          className="h-8 w-24"
          value={String(pageSize)}
          onChange={(e) =>
            setPageSize(e.target.value === "all" ? "all" : Number(e.target.value))
          }
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
          <option value="all">{t("all")}</option>
        </Select>
      </div>

      <span className="tabular-nums text-muted-foreground">
        {t("showingRange", { from, to, total })}
      </span>

      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("previous")}
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronRight className="size-4 rtl:hidden" />
            <ChevronLeft className="hidden size-4 rtl:block" />
          </Button>

          {pages.map((p, i) =>
            p === "…" ? (
              <span key={`e${i}`} className="px-1 text-muted-foreground">…</span>
            ) : (
              <button
                key={p}
                onClick={() => setPage(p)}
                aria-current={p === page ? "page" : undefined}
                className={cn(
                  "min-w-8 rounded-md px-2 py-1 text-sm tabular-nums transition-colors",
                  p === page
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground/80 hover:bg-accent",
                )}
              >
                {p}
              </button>
            ),
          )}

          <Button
            variant="ghost"
            size="icon"
            aria-label={t("next")}
            disabled={page >= pageCount}
            onClick={() => setPage(page + 1)}
          >
            <ChevronLeft className="size-4 rtl:hidden" />
            <ChevronRight className="hidden size-4 rtl:block" />
          </Button>
        </div>
      )}
    </div>
  );
}
