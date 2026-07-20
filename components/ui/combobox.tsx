"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ComboOption = {
  value: string;
  label: string;
  /** Extra text matched while searching but shown muted (phone, grade, …). */
  hint?: string | null;
};

/**
 * Searchable single-select, a drop-in for `<Select>` on long lists.
 *
 * Renders a hidden input so it still posts inside the FormData-based forms the
 * CRUD dialogs use. Filtering is client-side over an already-loaded list — the
 * centre's students/teachers number in the hundreds, not thousands, so a
 * round-trip per keystroke would be worse than sending the list once.
 */
export function Combobox({
  options,
  value,
  onChange,
  name,
  id,
  placeholder,
  disabled,
  required,
  className,
  allowClear = true,
}: {
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  /** Set to also post the value as form data. */
  name?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  allowClear?: boolean;
}) {
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.hint ? o.hint.toLowerCase().includes(q) : false),
    );
  }, [options, query]);

  // Close on outside click.
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
      setHighlight(Math.max(0, filtered.findIndex((o) => o.value === value)));
      // Focus after the panel paints so the caret lands in the search box.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[highlight];
      if (opt) pick(opt.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {name && <input type="hidden" name={name} value={value} required={required} />}

      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.label : (placeholder ?? "—")}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {allowClear && selected && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label={tc("clear")}
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="rounded p-0.5 opacity-60 hover:opacity-100"
            >
              <X className="size-3.5" />
            </span>
          )}
          <ChevronsUpDown className="size-4 opacity-50" />
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
          <div className="border-b border-border p-1.5">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={tc("searchPlaceholder")}
              className="h-8 w-full rounded bg-transparent px-2 text-sm outline-none"
            />
          </div>
          <ul ref={listRef} role="listbox" className="max-h-60 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <li className="px-2 py-3 text-center text-sm text-muted-foreground">
                {tc("noResults")}
              </li>
            )}
            {filtered.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(o.value)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-sm",
                  i === highlight && "bg-accent",
                )}
              >
                <span className="truncate">
                  {o.label}
                  {o.hint && (
                    <span className="ms-1.5 text-xs text-muted-foreground" dir="auto">
                      {o.hint}
                    </span>
                  )}
                </span>
                {o.value === value && <Check className="size-4 shrink-0" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
