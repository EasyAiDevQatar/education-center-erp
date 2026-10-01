"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarPlus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { TripPromptDialog, type TripPromptInfo } from "@/components/trip-prompt-dialog";
import { useModuleFlags } from "@/components/app-shell/module-flags";
import type { SessionFormOptions } from "@/lib/session-form-options";
import { saveSession } from "./actions";
import { SessionDialog } from "./session-dialog";

/** Standard individual-session booking, embedded in a student/teacher profile. */
export function ProfileAddSessionDialog({
  options,
  defaultStudentId,
  defaultTeacherId,
}: {
  options: SessionFormOptions;
  defaultStudentId?: string;
  defaultTeacherId?: string;
}) {
  const t = useTranslations("sessions");
  const locale = useLocale();
  const router = useRouter();
  const { transport } = useModuleFlags();
  const [tripPrompt, setTripPrompt] = useState<TripPromptInfo | null>(null);

  return (
    <>
      <SessionDialog
        title={t("add")}
        action={saveSession.bind(null, locale, null)}
        students={options.students}
        teachers={options.teachers}
        levels={options.levels}
        matrix={options.matrix}
        currency={options.currency}
        packages={options.packages}
        subjects={options.subjects}
        teacherSubjectIds={options.teacherSubjectIds}
        defaultStudentId={defaultStudentId}
        defaultTeacherId={defaultTeacherId}
        onHomeNeedsTrip={setTripPrompt}
        onSaved={() => router.refresh()}
        trigger={
          <Button className="gap-2">
            <CalendarPlus className="size-4" />
            {t("add")}
          </Button>
        }
      />
      {transport && (
        <TripPromptDialog info={tripPrompt} onClose={() => setTripPrompt(null)} />
      )}
    </>
  );
}
