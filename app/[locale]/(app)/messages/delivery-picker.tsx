"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { INTEGRATION_EVENTS, AUDIENCES } from "@/lib/integrations/types";
import { Input } from "@/components/ui/input";
import { saveDelivery, saveSelfNumbers } from "./delivery-actions";

/**
 * Who hears about what — one tick per event per person.
 *
 * This was two lists, which could only ever express a cross product: choosing
 * "teachers" and "payment received" together meant every teacher heard what
 * every family paid. A grid is the smallest thing that says what a centre
 * actually means — the teacher hears about the booking, the parent hears about
 * the payment, and the student hears about neither.
 *
 * Both axes come from lib/integrations/types.ts rather than being retyped, so
 * a new event is tickable the day it exists.
 */
export function DeliveryPicker({
  provider,
  configured,
  initialMatrix,
  initialSelfNumbers,
}: {
  provider: string;
  /** False when no credential is saved yet: the choices are meaningless until then. */
  configured: boolean;
  initialMatrix: Record<string, string[]>;
  initialSelfNumbers: string;
}) {
  const t = useTranslations("messages");
  const ti = useTranslations("integrations");
  const te = useTranslations("integrationEvents");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [matrix, setMatrix] = useState<Record<string, string[]>>(initialMatrix);
  const [selfNumbers, setSelfNumbers] = useState(initialSelfNumbers);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const has = (event: string, audience: string) => (matrix[event] ?? []).includes(audience);

  const toggle = (event: string, audience: string) =>
    setMatrix((m) => {
      const row = m[event] ?? [];
      return {
        ...m,
        [event]: row.includes(audience) ? row.filter((a) => a !== audience) : [...row, audience],
      };
    });

  // A whole-row switch: "nobody hears about this" is a common intent and
  // clearing four boxes to say it is four chances to leave one on.
  const toggleRow = (event: string) =>
    setMatrix((m) => ({
      ...m,
      [event]: (m[event] ?? []).length === AUDIENCES.length ? [] : [...AUDIENCES],
    }));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("deliveryIntro")}</p>
      {!configured && (
        <p className="rounded-md bg-muted/60 p-3 text-sm text-muted-foreground">
          {t("notConnected")}
        </p>
      )}

      <div className="rounded-lg border border-border p-3">
        <label className="mb-1 block text-sm font-medium" htmlFor="self-numbers">
          {t("selfNumbers")}
        </label>
        <p className="mb-2 text-xs text-muted-foreground">{t("selfNumbersHint")}</p>
        <Input
          id="self-numbers"
          dir="ltr"
          placeholder="+97430222761, +97430871010"
          value={selfNumbers}
          onChange={(e) => setSelfNumbers(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="p-2 text-start font-medium">{ti("events")}</th>
              {AUDIENCES.map((a) => (
                <th key={a} className="whitespace-nowrap p-2 text-center font-medium">
                  {ti(`audienceLabels.${a}`)}
                </th>
              ))}
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {INTEGRATION_EVENTS.map((event) => (
              <tr key={event} className="border-b border-border/60 last:border-0">
                <td className="p-2">{te.has(event) ? te(event) : event}</td>
                {AUDIENCES.map((a) => (
                  <td key={a} className="p-2 text-center">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={has(event, a)}
                      aria-label={`${te.has(event) ? te(event) : event} — ${ti(`audienceLabels.${a}`)}`}
                      onClick={() => toggle(event, a)}
                      className={cn(
                        "inline-flex size-6 items-center justify-center rounded border transition",
                        has(event, a)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background hover:bg-muted",
                      )}
                    >
                      {has(event, a) && <Check className="size-4" />}
                    </button>
                  </td>
                ))}
                <td className="p-2 text-center">
                  <button
                    type="button"
                    onClick={() => toggleRow(event)}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {(matrix[event] ?? []).length === AUDIENCES.length ? t("none") : t("all")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {msg && <p className="text-sm text-[var(--success)]">{msg}</p>}
      {err && (
        <p className="text-sm text-destructive">
          {t.has(`errors.${err}`) ? t(`errors.${err}`) : err}
        </p>
      )}

      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            setErr(null);
            const self = await saveSelfNumbers(locale, selfNumbers);
            if (!self.ok) {
              setErr(self.error ?? "invalid");
              return;
            }
            const res = await saveDelivery(locale, { provider, matrix: matrix as never });
            if (res.ok) {
              setMsg(tc("saved"));
              router.refresh();
            } else setErr(res.error ?? "invalid");
          })
        }
      >
        {pending ? tc("saving") : tc("save")}
      </Button>
    </div>
  );
}
