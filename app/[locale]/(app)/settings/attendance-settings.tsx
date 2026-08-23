"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { NO_SHOW_POLICIES, DEFAULT_NO_SHOW_POLICY } from "@/lib/attendance-policy";
import {
  BILLABLE_BASES,
  BILLABLE_ROUNDING_MINUTES,
  BILLABLE_ROUNDING_MODES,
  calculateBillableMinutes,
  type BillableBasis,
  type BillableRoundingMode,
} from "@/lib/attendance-billing";
import { formatDurationClock } from "@/lib/session-time";
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
    noShow: string;
    billableBasis: string;
    billableRoundingMinutes: string;
    billableRoundingMode: string;
    minimumBillableMinutes: string;
    capBillableAtPlanned: boolean;
  };
}) {
  const t = useTranslations("attendanceSettings");
  const tc = useTranslations("common");
  const tn = useTranslations("noShowPolicies");
  const locale = useLocale();
  const router = useRouter();

  const [walkIn, setWalkIn] = useState<WalkInMode>(
    (WALK_IN_MODES as readonly string[]).includes(values.walkIn)
      ? (values.walkIn as WalkInMode)
      : "FLAG",
  );
  const [pickSession, setPickSession] = useState(values.pickSession);
  const [graceHours, setGraceHours] = useState(values.graceHours);
  const [noShow, setNoShow] = useState(
    (NO_SHOW_POLICIES as readonly string[]).includes(values.noShow)
      ? values.noShow
      : DEFAULT_NO_SHOW_POLICY,
  );
  const [billableBasis, setBillableBasis] = useState<BillableBasis>(
    BILLABLE_BASES.includes(values.billableBasis as BillableBasis)
      ? (values.billableBasis as BillableBasis)
      : "PLANNED",
  );
  const initialRounding = Number(values.billableRoundingMinutes);
  const [billableRoundingMinutes, setBillableRoundingMinutes] = useState(
    (BILLABLE_ROUNDING_MINUTES as readonly number[]).includes(initialRounding)
      ? initialRounding
      : 1,
  );
  const [billableRoundingMode, setBillableRoundingMode] = useState<BillableRoundingMode>(
    BILLABLE_ROUNDING_MODES.includes(values.billableRoundingMode as BillableRoundingMode)
      ? (values.billableRoundingMode as BillableRoundingMode)
      : "NEAREST",
  );
  const [minimumBillableMinutes, setMinimumBillableMinutes] = useState(
    values.minimumBillableMinutes,
  );
  const [capBillableAtPlanned, setCapBillableAtPlanned] = useState(
    values.capBillableAtPlanned,
  );
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  const minimum = Math.min(
    1440,
    Math.max(0, Number.parseInt(minimumBillableMinutes, 10) || 0),
  );
  const previewMinutes = calculateBillableMinutes(
    { plannedHours: 1, actualMinutes: 4 },
    {
      basis: billableBasis,
      roundingMinutes: billableRoundingMinutes,
      roundingMode: billableRoundingMode,
      minimumMinutes: minimum,
      capAtPlanned: capBillableAtPlanned,
    },
  );

  function submit() {
    setSaved(false);
    start(async () => {
      const res = await saveAttendanceSettings(locale, {
        walkIn,
        pickSession,
        graceHours: Number.isFinite(Number(graceHours)) ? Number(graceHours) : 6,
        noShow: noShow as "CANCELLED" | "TAUGHT",
        billableBasis,
        billableRoundingMinutes,
        billableRoundingMode,
        minimumBillableMinutes: minimum,
        capBillableAtPlanned,
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

      {/* What an absence costs. Its own field rather than a line in the
          walk-in box: that one is about who a stray student belongs to, this
          one is about whether a parent is charged. */}
      <FormField label={t("noShow")} htmlFor="no-show" hint={t(`noShowHints.${noShow}`)}>
        <Select id="no-show" value={noShow} onChange={(e) => setNoShow(e.target.value)}>
          {NO_SHOW_POLICIES.map((p) => (
            <option key={p} value={p}>
              {tn(p)}
            </option>
          ))}
        </Select>
      </FormField>

      <div className="space-y-4 border-t border-border pt-4">
        <div>
          <h3 className="font-semibold">{t("billingTitle")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("billingHint")}</p>
        </div>

        <FormField label={t("billableBasis")} htmlFor="billable-basis" hint={t("billableBasisHint")}>
          <Select
            id="billable-basis"
            value={billableBasis}
            onChange={(e) => setBillableBasis(e.target.value as BillableBasis)}
          >
            {BILLABLE_BASES.map((basis) => (
              <option key={basis} value={basis}>{t(`billableBases.${basis}`)}</option>
            ))}
          </Select>
        </FormField>

        <div className="grid gap-4 md:grid-cols-2">
          <FormField label={t("roundingMinutes")} htmlFor="rounding-minutes" hint={t("roundingMinutesHint")}>
            <Select
              id="rounding-minutes"
              value={String(billableRoundingMinutes)}
              onChange={(e) => setBillableRoundingMinutes(Number(e.target.value))}
            >
              {BILLABLE_ROUNDING_MINUTES.map((minutes) => (
                <option key={minutes} value={minutes}>{t("minutesOption", { n: minutes })}</option>
              ))}
            </Select>
          </FormField>

          <FormField label={t("roundingMode")} htmlFor="rounding-mode" hint={t("roundingModeHint")}>
            <Select
              id="rounding-mode"
              value={billableRoundingMode}
              onChange={(e) => setBillableRoundingMode(e.target.value as BillableRoundingMode)}
            >
              {BILLABLE_ROUNDING_MODES.map((mode) => (
                <option key={mode} value={mode}>{t(`roundingModes.${mode}`)}</option>
              ))}
            </Select>
          </FormField>
        </div>

        <FormField
          label={t("minimumBillableMinutes")}
          htmlFor="minimum-billable-minutes"
          hint={t("minimumBillableMinutesHint")}
        >
          <Input
            id="minimum-billable-minutes"
            type="number"
            min="0"
            max="1440"
            dir="ltr"
            className="w-32"
            value={minimumBillableMinutes}
            onChange={(e) => setMinimumBillableMinutes(e.target.value)}
          />
        </FormField>

        <FormField label={t("capAtPlanned")} htmlFor="cap-at-planned" hint={t("capAtPlannedHint")}>
          <label className="flex items-center gap-2 text-sm">
            <input
              id="cap-at-planned"
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={capBillableAtPlanned}
              onChange={(e) => setCapBillableAtPlanned(e.target.checked)}
            />
            {t("capAtPlannedLabel")}
          </label>
        </FormField>

        <p className="rounded-md bg-muted px-3 py-2 text-sm" aria-live="polite">
          {t("billingPreview", {
            planned: formatDurationClock(60),
            actual: formatDurationClock(4),
            billable: formatDurationClock(previewMinutes),
          })}
        </p>
      </div>

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
