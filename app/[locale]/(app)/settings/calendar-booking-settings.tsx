"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarPlus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { saveCalendarBookingSetting } from "./actions";

/** Admin gate for creating new individual or group bookings from the calendar. */
export function CalendarBookingSettings({ enabled }: { enabled: boolean }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setSaved(false);
      const result = await saveCalendarBookingSetting(locale, on);
      if (result.ok) {
        setSaved(true);
        router.refresh();
      }
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <CalendarPlus className="size-5 text-primary" />
        <span className="font-semibold">{t("calendarBooking")}</span>
      </div>
      <p className="text-sm text-muted-foreground">{t("calendarBookingHint")}</p>
      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 transition hover:bg-accent">
        <input
          type="checkbox"
          checked={on}
          onChange={(event) => setOn(event.target.checked)}
          className="mt-0.5 size-4 accent-primary"
        />
        <span>
          <span className="block text-sm font-medium">{t("calendarBookingEnabled")}</span>
          <span className="block text-xs text-muted-foreground">{t("calendarBookingEnabledHint")}</span>
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={pending} onClick={save}>{pending ? tc("saving") : tc("save")}</Button>
        {saved && <span className="text-sm text-[var(--success)]">{tc("saved")}</span>}
      </div>
    </div>
  );
}
