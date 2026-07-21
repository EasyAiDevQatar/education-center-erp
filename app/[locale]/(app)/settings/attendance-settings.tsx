"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { saveAttendanceSettings } from "./attendance-actions";

/** What to do when a scanned student has nothing booked today. */
const WALK_IN_MODES = ["FLAG", "ASSIGN", "ASK", "NONE"] as const;
type WalkInMode = (typeof WALK_IN_MODES)[number];

export function AttendanceSettings({
  values,
}: {
  values: {
    walkIn: string;
    pickSession: boolean;
    graceHours: string;
  };
}) {
  const t = useTranslations("attendanceSettings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [walkIn, setWalkIn] = useState<WalkInMode>(
    (WALK_IN_MODES as readonly string[]).includes(values.walkIn)
      ? (values.walkIn as WalkInMode)
      : "FLAG",
  );
  const [pickSession, setPickSession] = useState(values.pickSession);
  const [graceHours, setGraceHours] = useState(values.graceHours);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  function submit() {
    setSaved(false);
    start(async () => {
      const res = await saveAttendanceSettings(locale, {
        walkIn,
        pickSession,
        graceHours: parseInt(graceHours, 10) || 6,
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <FormField label={t("pickSession")} htmlFor="pick-session" hint={t("pickSessionHint")}>
        <label className="flex items-center gap-2 text-sm">
          <input
            id="pick-session"
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={pickSession}
            onChange={(e) => setPickSession(e.target.checked)}
          />
          {t("pickSessionLabel")}
        </label>
      </FormField>

      <FormField label={t("walkIn")} htmlFor="walk-in" hint={t(`walkInHints.${walkIn}`)}>
        <Select id="walk-in" value={walkIn} onChange={(e) => setWalkIn(e.target.value as WalkInMode)}>
          {WALK_IN_MODES.map((m) => (
            <option key={m} value={m}>{t(`walkInModes.${m}`)}</option>
          ))}
        </Select>
      </FormField>

      <FormField label={t("graceHours")} htmlFor="grace" hint={t("graceHoursHint")}>
        <Input
          id="grace"
          type="number"
          min="0"
          max="168"
          dir="ltr"
          className="w-32"
          value={graceHours}
          onChange={(e) => setGraceHours(e.target.value)}
        />
      </FormField>

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending} onClick={submit}>
          {pending ? tc("saving") : tc("save")}
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm text-[var(--success)]">
            <Check className="size-4" />
            {tc("saved")}
          </span>
        )}
      </div>
    </div>
  );
}
