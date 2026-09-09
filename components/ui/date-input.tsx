"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { formatDateOnly, parseDateOnlyInput } from "@/lib/date-only";
import { cn } from "@/lib/utils";

type DateInputProps = Omit<React.ComponentProps<"input">, "type">;

const DATE_PLACEHOLDER = "DD/MM/YYYY";
const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function stringValue(value: React.ComponentProps<"input">["value"]): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function validIsoValue(value: React.ComponentProps<"input">["value"]): string {
  const text = stringValue(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && formatDateOnly(text) !== "—" ? text : "";
}

function westernDigits(value: string): string {
  return value
    .replace(BIDI_CONTROLS, "")
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => {
      const code = digit.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    });
}

/** Normalize typing and pasting into an easy-to-enter DD/MM/YYYY draft. */
export function normalizeDateInputDraft(value: string): string {
  const normalized = westernDigits(value.trim());
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const formatted = formatDateOnly(normalized);
    if (formatted !== "—") return formatted;
  }

  // Once separators exist, preserve their positions. This lets someone select
  // and replace just the day, month, or year without the remaining digits
  // jumping into different date segments after the first keystroke.
  if (normalized.includes("/")) {
    const sanitized = normalized.replace(/[^\d/]/g, "");
    const parts = sanitized.split("/");
    if (parts[0].length <= 2 && parts.length >= 3) {
      return `${parts[0]}/${parts[1].slice(0, 2)}/${parts.slice(2).join("").slice(0, 4)}`;
    }
    if (parts[0].length <= 2 && parts.length === 2) {
      const remainder = parts[1].slice(0, 6);
      return remainder.length <= 2
        ? `${parts[0]}/${remainder}`
        : `${parts[0]}/${remainder.slice(0, 2)}/${remainder.slice(2)}`;
    }
  }

  const digits = normalized.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function displayValue(iso: string): string {
  if (!iso) return "";
  const formatted = formatDateOnly(iso);
  return formatted === "—" ? "" : formatted;
}

function validationMessage(draft: string, iso: string, min?: string | number, max?: string | number) {
  if (!draft) return "";
  if (!iso) return DATE_PLACEHOLDER;

  const minimum = validIsoValue(min);
  const maximum = validIsoValue(max);
  if ((minimum && iso < minimum) || (maximum && iso > maximum)) return DATE_PLACEHOLDER;
  return "";
}

function isoChangeEvent(
  source: React.ChangeEvent<HTMLInputElement>,
  canonical: HTMLInputElement,
): React.ChangeEvent<HTMLInputElement> {
  return {
    ...source,
    target: canonical,
    currentTarget: canonical,
  } as React.ChangeEvent<HTMLInputElement>;
}

/**
 * A day-first text field backed by a native ISO date picker.
 *
 * The person always types and sees DD/MM/YYYY, while the named native control
 * remains the canonical YYYY-MM-DD form value. This avoids the browser/OS
 * locale changing the segment order in Arabic or English.
 */
const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  (
    {
      className,
      autoComplete,
      defaultValue,
      disabled,
      form,
      hidden,
      id,
      inputMode,
      max,
      maxLength,
      min,
      name,
      onChange,
      onClick,
      placeholder,
      readOnly,
      required,
      step,
      style,
      value,
      ...props
    },
    forwardedRef,
  ) => {
    const pickerRef = React.useRef<HTMLInputElement | null>(null);
    const visibleRef = React.useRef<HTMLInputElement | null>(null);
    const pickerId = React.useId();
    const controlled = value !== undefined;
    const controlledKey = controlled ? stringValue(value) : undefined;
    const initialIso = validIsoValue(controlled ? value : defaultValue);
    const [state, setState] = React.useState(() => ({
      controlledKey,
      draft: displayValue(initialIso),
      iso: initialIso,
    }));

    // Synchronize a genuinely new controlled value while retaining an
    // in-progress DD/MM/YYYY draft when its ISO prop has not changed.
    if (controlled && state.controlledKey !== controlledKey) {
      const iso = validIsoValue(value);
      setState({ controlledKey, draft: displayValue(iso), iso });
    }

    const current =
      controlled && state.controlledKey !== controlledKey
        ? {
            controlledKey,
            draft: displayValue(validIsoValue(value)),
            iso: validIsoValue(value),
          }
        : state;
    const invalidMessage = validationMessage(current.draft, current.iso, min, max);

    const setVisibleRef = React.useCallback(
      (node: HTMLInputElement | null) => {
        visibleRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    React.useEffect(() => {
      visibleRef.current?.setCustomValidity(invalidMessage);
    }, [invalidMessage]);

    // Controlled fields reset to their prop; uncontrolled fields reset to the
    // latest defaultValue, matching native form-reset behaviour.
    const resetIsoRef = React.useRef(initialIso);
    resetIsoRef.current = validIsoValue(controlled ? value : defaultValue);
    React.useEffect(() => {
      const input = visibleRef.current;
      const ownerForm = input?.form;
      if (!input || !ownerForm) return;

      let timer: ReturnType<typeof setTimeout> | undefined;
      const handleReset = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          const iso = resetIsoRef.current;
          setState({
            controlledKey: controlled ? stringValue(value) : undefined,
            draft: displayValue(iso),
            iso,
          });
        }, 0);
      };

      ownerForm.addEventListener("reset", handleReset);
      return () => {
        ownerForm.removeEventListener("reset", handleReset);
        if (timer !== undefined) clearTimeout(timer);
      };
    }, [controlled, form, value]);

    const emitChange = (source: React.ChangeEvent<HTMLInputElement>, iso: string) => {
      const canonical = pickerRef.current;
      if (!canonical) return;
      canonical.value = iso;
      onChange?.(isoChangeEvent(source, canonical));
    };

    const updateFromText = (event: React.ChangeEvent<HTMLInputElement>) => {
      const draft = normalizeDateInputDraft(event.currentTarget.value);
      const iso = parseDateOnlyInput(draft) ?? "";
      setState({ controlledKey, draft, iso });

      // Native date inputs only expose complete ISO values. Match that
      // contract: notify on a complete valid date, or when explicitly cleared.
      if (iso || !draft) emitChange(event, iso);
    };

    const updateFromPicker = (event: React.ChangeEvent<HTMLInputElement>) => {
      const iso = validIsoValue(event.currentTarget.value);
      setState({ controlledKey, draft: displayValue(iso), iso });
      onChange?.(event);
    };

    return (
      <span
        className={cn(
          "relative",
          className,
          disabled && "cursor-not-allowed opacity-50",
          "has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        )}
        hidden={hidden}
        style={style}
      >
        <input
          {...props}
          ref={setVisibleRef}
          id={id}
          type="text"
          dir="ltr"
          form={form}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          inputMode={inputMode ?? "numeric"}
          maxLength={maxLength ?? 10}
          autoComplete={autoComplete ?? "off"}
          placeholder={placeholder ?? DATE_PLACEHOLDER}
          value={current.draft}
          aria-invalid={props["aria-invalid"] ?? (invalidMessage ? true : undefined)}
          aria-describedby={props["aria-describedby"]}
          className="h-full min-w-0 flex-1 bg-transparent p-0 pe-7 text-left tabular-nums outline-none placeholder:text-muted-foreground"
          onChange={updateFromText}
          onClick={onClick}
        />
        <button
          type="button"
          aria-label="Choose date"
          aria-controls={pickerId}
          disabled={disabled || readOnly}
          className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-sm p-0.5 text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
          onClick={(event) => {
            event.preventDefault();
            const picker = pickerRef.current;
            if (!picker) return;
            try {
              if (typeof picker.showPicker === "function") picker.showPicker();
              else picker.click();
            } catch {
              picker.click();
            }
          }}
        >
          <CalendarDays className="size-4" aria-hidden="true" />
        </button>
        <input
          ref={pickerRef}
          id={pickerId}
          type="date"
          name={name}
          form={form}
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          readOnly={readOnly}
          min={min}
          max={max}
          step={step}
          value={current.iso}
          className="pointer-events-none absolute right-2 top-1/2 size-px -translate-y-1/2 opacity-0"
          onChange={updateFromPicker}
        />
      </span>
    );
  },
);
DateInput.displayName = "DateInput";

export { DateInput };
