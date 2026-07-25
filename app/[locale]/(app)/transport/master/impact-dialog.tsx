"use client";

import { useEffect, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { AlertTriangle, Ban, Bus, Check, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { hhmm } from "@/components/transport/timeline";
import { previewReschedule, confirmReschedule, type ImpactPreview, type MoveInput } from "./actions";

/**
 * The seam between a drawing and a change.
 *
 * A dragged lesson is a proposal until somebody reads what it costs and says
 * yes. This dialog is that reading: what it does to the cars, who loses a ride,
 * which approvals it revokes, and who gets told. Nothing here writes — the
 * confirm button is the only thing that does, and it re-checks everything on
 * the server before it does, because a preview read a minute ago proves
 * nothing about now.
 */
export function ImpactDialog({
  open,
  onOpenChange,
  move,
  onApplied,
  onRetime,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  move: MoveInput;
  /** Called after a successful write, so the board can drop its proposal. */
  onApplied: () => void;
  /** Accepting the suggested time re-aims the proposal instead of saving. */
  onRetime: (startMin: number) => void;
}) {
  const t = useTranslations("transportMaster");
  // Borrowed rather than reinvented: these two panels already have a settled
  // wording in both languages, and a dialog that described the same clash in
  // different words would read as a different rule.
  const tc = useTranslations("conflicts");
  const ts = useTranslations("spacing");
  const locale = useLocale();
  const router = useRouter();

  const [impact, setImpact] = useState<ImpactPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, startSaving] = useTransition();

  // Mounted only while open (the board unmounts it on close), so there is no
  // stale answer to clear here — and clearing it in the effect body would be a
  // cascading render for no benefit.
  useEffect(() => {
    let live = true;
    previewReschedule(locale, move)
      .then((res) => {
        if (!live) return;
        if ("error" in res && res.error) setError(res.error);
        else setImpact(res as ImpactPreview);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [locale, move]);

  const blocked = (impact?.blockers.length ?? 0) > 0;
  /** Only a configured refusal makes tight travel a veto rather than a warning. */
  const spacingBlocks = impact?.blockers.some((b) => b.code === "noRoomToTravel") ?? false;

  const save = () =>
    startSaving(async () => {
      const res = await confirmReschedule(locale, move);
      if (res.error) {
        setError(res.error);
        return;
      }
      onApplied();
      onOpenChange(false);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("impactTitle")}</DialogTitle>
          {impact && (
            <p className="text-sm text-muted-foreground" dir="auto">
              {t("proposalMove", {
                student: impact.studentName,
                teacher: impact.teacherName,
                fromRange: `${hhmm(impact.from.startMin)}–${hhmm(impact.from.endMin)}`,
                toRange: `${hhmm(impact.to.startMin)}–${hhmm(impact.to.endMin)}`,
              })}
            </p>
          )}
        </DialogHeader>

        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("impactWorking")}
          </p>
        )}

        {error && (
          <p className="flex items-center gap-2 rounded-md border border-destructive bg-destructive/10 p-2.5 text-sm text-destructive">
            <Ban className="size-4 shrink-0" />
            {t.has(`blocked.${error}`) ? t(`blocked.${error}`) : error}
          </p>
        )}

        {impact && (
          <div className="space-y-3 text-sm">
            {/* Refusals first, and every one of them — a move blocked for two
                reasons should say both rather than reveal them one at a time. */}
            {blocked && (
              <div className="rounded-md border border-destructive bg-destructive/10 p-2.5">
                <p className="flex items-center gap-1 font-medium text-destructive">
                  <Ban className="size-4 shrink-0" />
                  {t("impactBlocked")}
                </p>
                <ul className="ms-5 list-disc space-y-0.5">
                  {impact.blockers.map((b) => (
                    <li key={b.code}>
                      {t(`blocked.${b.code}`)}
                      {b.lockReason && ` — ${t(`lock.${b.lockReason}`)}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Clashes: advisory, in the same words the booking forms use. */}
            {impact.conflicts.length > 0 && (
              <div className="rounded-md border border-warning bg-warning/10 p-2.5">
                <p className="flex items-center gap-1 font-medium">
                  <AlertTriangle className="size-4 shrink-0" />
                  {tc("title")}
                </p>
                <ul className="ms-5 list-disc space-y-0.5">
                  {impact.conflicts.map((c, i) => (
                    <li key={i}>
                      {c.kind === "OUTSIDE_AVAILABILITY"
                        ? tc("outsideAvailability")
                        : c.kind === "TEACHER_BUSY"
                          ? c.studentName
                            ? tc("teacherBusy", { name: c.studentName })
                            : tc("teacherBusyPlain")
                          : c.studentName
                            ? tc("studentBusy", { name: c.studentName })
                            : tc("studentBusyPlain")}
                    </li>
                  ))}
                </ul>
                {/* A clash never blocks here either — same promise as the
                    booking forms make. */}
                <p className="mt-1 text-xs text-muted-foreground">{tc("advisory")}</p>
              </div>
            )}

            {/* Travel room: louder, because it is a physical impossibility
                rather than a clash somebody can decide to accept. */}
            {impact.spacing.length > 0 && (
              // Colour carries the override semantics, exactly as the booking
              // form's panel does: red means refused, amber means "we think
              // this is tight". Painting a non-blocking warning red would
              // teach people that red is ignorable.
              <div
                className={`rounded-md p-2.5 ${
                  spacingBlocks
                    ? "border border-destructive bg-destructive/10"
                    : "border border-warning bg-warning/10"
                }`}
              >
                <p className="flex items-center gap-1 font-medium">
                  <TriangleAlert className="size-4 shrink-0" />
                  {spacingBlocks ? ts("titleBlocking") : ts("title")}
                </p>
                <ul className="ms-5 list-disc space-y-0.5">
                  {impact.spacing.map((sp, i) => (
                    <li key={i}>
                      {ts(sp.kind === "OVERLAP" ? "overlap" : "tooTight", {
                        name: sp.otherLabel,
                        from: hhmm(sp.otherStartMin),
                        to: hhmm(sp.otherEndMin),
                        need: sp.requiredGapMin,
                        short: sp.shortfallMin,
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {impact.suggestedStartMin != null && (
              <p className="flex flex-wrap items-center gap-2">
                <span>{ts("suggestion", { time: hhmm(impact.suggestedStartMin) })}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onRetime(impact.suggestedStartMin!);
                    onOpenChange(false);
                  }}
                >
                  {ts("useSuggestion", { time: hhmm(impact.suggestedStartMin) })}
                </Button>
              </p>
            )}

            {/* What it does to the cars. */}
            <div>
              <p className="mb-1 flex items-center gap-1 font-medium">
                <Bus className="size-4 shrink-0 text-violet-600" />
                {t("impactRides")}
              </p>
              {impact.rides.length === 0 ? (
                <p className="text-muted-foreground">{t("impactRidesNone")}</p>
              ) : (
                <ul className="ms-5 list-disc space-y-0.5">
                  {impact.rides.map((r, i) => (
                    <li key={i} dir="auto">
                      {r.beforeMin == null
                        ? t("impactRideNew", { who: r.passengerName, after: hhmm(r.afterMin ?? 0) })
                        : r.afterMin == null
                          ? t("impactRideLost", { who: r.passengerName, before: hhmm(r.beforeMin) })
                          : t("impactRideRow", {
                              who: r.passengerName,
                              before: hhmm(r.beforeMin),
                              after: hhmm(r.afterMin),
                            })}
                    </li>
                  ))}
                </ul>
              )}
              {impact.strandedNames.length > 0 && (
                <p className="mt-1 text-destructive">
                  {t("impactStranded", { names: impact.strandedNames.join("، ") })}
                </p>
              )}
            </div>

            {/* The operational delta, stated in whichever direction it runs. */}
            <p className="text-muted-foreground">
              {impact.savingMinutes === 0 && impact.savingKm === 0
                ? t("impactNeutral")
                : impact.savingMinutes >= 0 && impact.savingKm >= 0
                  ? t("impactSaving", { min: impact.savingMinutes, km: impact.savingKm })
                  : t("impactCost", {
                      min: Math.abs(impact.savingMinutes),
                      km: Math.abs(impact.savingKm),
                    })}
            </p>

            {impact.tripsNeedingReview > 0 && (
              <p className="text-muted-foreground">
                {t("impactReview", { n: impact.tripsNeedingReview })}
              </p>
            )}
            {impact.notifyNames.length > 0 && (
              <p className="text-muted-foreground" dir="auto">
                {t("impactNotify", { names: impact.notifyNames.join("، ") })}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("proposalCancel")}
          </Button>
          <Button
            type="button"
            className="gap-1"
            disabled={!impact || blocked || loading || saving}
            onClick={save}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {t("impactConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
