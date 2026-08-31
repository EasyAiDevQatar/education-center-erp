"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Ban, Building2, Check, Clock, Home, Search, UserRoundPlus, Users } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";
import { cancelGroupOccurrence, updateGroupOccurrenceRoster } from "../sessions/actions";
import type { StudentOpt } from "../sessions/session-dialog";
import type { CalEvent } from "./calendar-client";

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatTime(minutes: number) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function GroupOccurrenceDialog({
  event,
  currency,
  students,
  onClose,
}: {
  event: CalEvent;
  currency: string;
  students: StudentOpt[];
  onClose: () => void;
}) {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("calendar");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const [confirming, setConfirming] = useState(false);
  const [managing, setManaging] = useState(false);
  const [query, setQuery] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // The parent renders this dialog only for grouped calendar events.
  const group = event.group!;
  const active = group.members.filter((member) => member.status !== "CANCELLED");
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(
    () => new Set(active.map((member) => member.studentId)),
  );
  const canCancelAll = active.every(
    (member) => member.status === "DRAFT" || member.status === "SCHEDULED",
  );
  const canManageRoster = canCancelAll;
  const filteredStudents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return students.filter(
      (student) =>
        (!gradeFilter || String(student.gradeYear ?? "") === gradeFilter) &&
        (!needle || student.name.toLowerCase().includes(needle)),
    );
  }, [students, query, gradeFilter]);

  const toggleStudent = (studentId: string) => {
    setSelectedStudentIds((current) => {
      const next = new Set(current);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-primary">
              <Users className="size-4" />
            </span>
            <span className="min-w-0 truncate">{group.name || t("groupSession")}</span>
            <Badge variant="default" className="ms-auto shrink-0">
              {t("studentsCount", { n: active.length })}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/60 p-3 text-sm">
          <span className="flex items-center gap-1.5">
            <Clock className="size-4 text-muted-foreground" />
            <bdi dir="ltr">{event.day} · {formatTime(event.startMinutes)}–{formatTime(event.startMinutes + Math.round(event.hours * 60))}</bdi>
          </span>
          <span className="flex items-center gap-1.5">
            {event.location === "HOME" ? <Home className="size-4" /> : <Building2 className="size-4" />}
            {te(`location.${event.location}`)} · {event.hours}h
          </span>
          <span className="col-span-2 text-muted-foreground">
            {event.teacherName || "—"}
          </span>
        </div>

        {managing ? (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute start-2 top-2.5 size-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("searchStudents")}
                  className="ps-8"
                />
              </div>
              <Select
                value={gradeFilter}
                onChange={(event) => setGradeFilter(event.target.value)}
                aria-label={t("filterByGrade")}
                className="w-32"
              >
                <option value="">{t("allGrades")}</option>
                {Array.from({ length: 12 }, (_, index) => index + 1).map((grade) => (
                  <option key={grade} value={grade}>{t("gradeYearN", { n: grade })}</option>
                ))}
              </Select>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("selectedStudents", { n: selectedStudentIds.size })}</span>
              <span>{t("thisOccurrenceOnly")}</span>
            </div>
            <div className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {filteredStudents.map((student) => {
                const selected = selectedStudentIds.has(student.id);
                return (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => toggleStudent(student.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-accent"
                  >
                    <span className={`grid size-5 shrink-0 place-items-center rounded border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                      {selected && <Check className="size-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{student.name}</span>
                    {student.gradeYear != null && (
                      <Badge variant="muted">{t("gradeYearShort", { n: student.gradeYear })}</Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
        <div className="max-h-80 space-y-1 overflow-y-auto pe-1">
          {group.members.map((member, index) => (
            <div
              key={member.id}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{member.studentName}</span>
                <span className="block truncate text-xs text-muted-foreground">{member.levelLabel}</span>
              </span>
              <Badge variant={member.status === "CANCELLED" ? "muted" : member.status === "COMPLETED" ? "success" : "default"}>
                {te(`sessionStatus.${member.status as "SCHEDULED"}`)}
              </Badge>
              <span className="w-20 shrink-0 text-end tabular-nums" dir="ltr">
                {formatMoney(member.total)} {currency}
              </span>
            </div>
          ))}
        </div>
        )}

        <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          {t("individualAccountingHint")}
        </p>

        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t.has(`bulkCancelErrors.${error}`)
              ? t(`bulkCancelErrors.${error}`)
              : tc.has(`errors.${error}`)
                ? tc(`errors.${error}`)
                : tc("errorGeneric")}
            {errorDetail && <span className="mt-1 block">{errorDetail}</span>}
          </p>
        )}

        {!canCancelAll && active.length > 0 && (
          <p className="text-xs text-warning">{t("bulkCancelBlocked")}</p>
        )}
        {confirming && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
            {t("bulkCancelConfirm", { n: active.length })}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {tc("close")}
          </Button>
          {managing ? (
            <>
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setManaging(false)}>
                {tc("back")}
              </Button>
              <Button
                type="button"
                disabled={pending || selectedStudentIds.size === 0}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    setErrorDetail(null);
                    const result = await updateGroupOccurrenceRoster(locale, {
                      sessionIds: group.members.map((member) => member.id),
                      studentIds: [...selectedStudentIds],
                    });
                    if (result.error) {
                      setError(result.error);
                      setErrorDetail(result.detail ?? null);
                    } else {
                      onClose();
                      router.refresh();
                    }
                  })
                }
              >
                {pending ? tc("saving") : t("saveRoster")}
              </Button>
            </>
          ) : confirming ? (
            <>
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
                {tc("back")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending || !canCancelAll || active.length === 0}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const result = await cancelGroupOccurrence(locale, {
                      sessionIds: group.members.map((member) => member.id),
                    });
                    if (result.error) setError(result.error);
                    else {
                      onClose();
                      router.refresh();
                    }
                  })
                }
              >
                <Ban className="size-4" />
                {pending ? tc("saving") : t("bulkCancelAction", { n: active.length })}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={!canManageRoster}
                onClick={() => {
                  setError(null);
                  setErrorDetail(null);
                  setManaging(true);
                }}
              >
                <UserRoundPlus className="size-4" />
                {t("manageRoster")}
              </Button>
              {active.length > 0 && (
              <Button
                type="button"
                variant="destructive"
                disabled={!canCancelAll}
                onClick={() => setConfirming(true)}
              >
                <Ban className="size-4" />
                {t("bulkCancelAction", { n: active.length })}
              </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
