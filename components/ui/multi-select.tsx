"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { normalizeArabic } from "@/components/ui/table-search";
import { cn } from "@/lib/utils";

export type MultiOption = { value: string; label: string; hint?: string | null };

/**
 * Searchable multi-select with chips.
 *
 * Emits one hidden input per selected value so it posts through the same
 * FormData path the CRUD dialogs already use — the server reads them with
 * `formData.getAll(name)`. Filtering folds Arabic the same way the search box
 * does, so "احمد" still finds "أحمد".
 */
export function MultiSelect({
  options,
  value,
  onChange,
  name,
  id,
  placeholder,
  disabled,
  className,
  emptyHint,
}: {
  options: MultiOption[];
  value: string[];
  onChange: (value: string[]) => void;
  /** Set to also post the values as form data. */
  name?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Shown under the control when nothing is selected. */
  emptyHint?: string;
}) {
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => options.filter((o) => value.includes(o.value)),
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = normalizeArabic(query);
    if (!q) return options;
    return options.filter(
      (o) =>
        normalizeArabic(o.label).includes(q) ||
        (o.hint ? normalizeArabic(o.hint).includes(q) : false),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {name && value.map((v) => <input key={v} type="hidden" name={name} value={v} />)}

      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className="flex flex-wrap gap-1">
          {selected.length === 0 && (
            <span className="px-1 text-muted-foreground">{placeholder ?? "—"}</span>
          )}
          {selected.map((o) => (
            <span
              key={o.value}
              className="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-xs"
            >
              {o.label}
              <span
                role="button"
                tabIndex={-1}
                aria-label={tc("clear")}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(o.value);
                }}
                className="opacity-60 hover:opacity-100"
              >
                <X className="size-3" />
              </span>
            </span>
          ))}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </button>

      {emptyHint && selected.length === 0 && (
        <p className="mt-1 text-xs text-muted-foreground">{emptyHint}</p>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
          <div className="border-b border-border p-1.5">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tc("searchPlaceholder")}
              className="h-8 w-full rounded bg-transparent px-2 text-sm outline-none"
            />
          </div>
          <ul role="listbox" aria-multiselectable className="max-h-60 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <li className="px-2 py-3 text-center text-sm text-muted-foreground">
                {tc("noResults")}
              </li>
            )}
            {filtered.map((o) => {
              const on = value.includes(o.value);
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={on}
                  onClick={() => toggle(o.value)}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded border",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                    )}
                  >
                    {on && <Check className="size-3" />}
                  </span>
                  <span className="truncate">
                    {o.label}
                    {o.hint && (
                      <span className="ms-1.5 text-xs text-muted-foreground">{o.hint}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
