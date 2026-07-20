"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Trash2, Copy } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { minToHHMM, hhmmToMin } from "@/lib/planner";
import { WEEKDAY_ORDER } from "@/lib/conflicts";
import { saveAvailability } from "../availability-actions";

export type Window = { weekday: number; startMin: number; endMin: number };

/** Weekly working-hours editor — Saturday-first, one row per window. */
export function AvailabilityEditor({
  teacherId,
  initial,
}: {
  teacherId: string;
  initial: Window[];
}) {
  const t = useTranslations("availability");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();

  const [windows, setWindows] = useState<Window[]>(initial);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  const forDay = (wd: number) => windows.filter((w) => w.weekday === wd);

  function add(weekday: number) {
    const existing = forDay(weekday);
    // Chain a new window after the last one, else a sensible afternoon default.
    const startMin = existing.length
      ? Math.min(Math.max(...existing.map((w) => w.endMin)) + 30, 22 * 60)
      : 14 * 60;
    setWindows((prev) => [...prev, { weekday, startMin, endMin: Math.min(startMin + 240, 24 * 60) }]);
    setSaved(false);
  }

  function update(index: number, patch: Partial<Window>) {
    setWindows((prev) => prev.map((w, i) => (i === index ? { ...w, ...patch } : w)));
    setSaved(false);
  }

  function remove(index: number) {
    setWindows((prev) => prev.filter((_, i) => i !== index));
    setSaved(false);
  }

  /** Copy this day's windows onto every other weekday that has none. */
  function copyToWeek(weekday: number) {
    const src = forDay(weekday);
    if (src.length === 0) return;
    setWindows((prev) => {
      const kept = prev.filter((w) => w.weekday === weekday);
      const copies = WEEKDAY_ORDER.filter((wd) => wd !== weekday).flatMap((wd) =>
        src.map((w) => ({ weekday: wd, startMin: w.startMin, endMin: w.endMin })),
      );
      return [...kept, ...copies];
    });
    setSaved(false);
  }

  function submit() {
    start(async () => {
      const res = await saveAvailability(locale, { teacherId, windows });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>{t("title")}</CardTitle>
        <Button size="sm" disabled={pending} onClick={submit}>
          {pending ? tc("saving") : tc("save")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {windows.length === 0 ? t("emptyHint") : t("hint")}
        </p>

        <div className="space-y-2">
          {WEEKDAY_ORDER.map((wd) => {
            const rows = windows
              .map((w, i) => ({ w, i }))
              .filter(({ w }) => w.weekday === wd);
            return (
              <div key={wd} className="rounded-md border border-border p-2">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{te(`weekday.${wd}`)}</span>
                  <div className="flex gap-1">
                    {rows.length > 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={t("copyToWeek")}
                        title={t("copyToWeek")}
                        onClick={() => copyToWeek(wd)}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={t("addWindow")}
                      title={t("addWindow")}
                      onClick={() => add(wd)}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </div>

                {rows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("dayOff")}</p>
                ) : (
                  <div className="space-y-1.5">
                    {rows.map(({ w, i }) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          type="time"
                          dir="ltr"
                          className="w-32"
                          aria-label={t("from")}
                          value={minToHHMM(w.startMin)}
                          onChange={(e) =>
                            update(i, { startMin: hhmmToMin(e.target.value, w.startMin) })
                          }
                        />
                        <span className="text-muted-foreground">—</span>
                        <Input
                          type="time"
                          dir="ltr"
                          className="w-32"
                          aria-label={t("to")}
                          value={minToHHMM(w.endMin)}
                          onChange={(e) =>
                            update(i, { endMin: hhmmToMin(e.target.value, w.endMin) })
                          }
                        />
                        {w.endMin <= w.startMin && (
                          <span className="text-xs text-destructive">{t("invalidRange")}</span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 ms-auto"
                          aria-label={tc("delete")}
                          onClick={() => remove(i)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {saved && <p className="text-sm text-[var(--success)]">{tc("saved")}</p>}
      </CardContent>
    </Card>
  );
}
