"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { formatMoney } from "@/lib/money";
import { localNowTime, localToday } from "@/lib/session-time";
import { ConflictWarnings, useConflictCheck } from "@/components/conflict-warnings";

export type StudentOpt = {
  id: string;
  name: string;
  gradeLevelId: string | null;
  /** School year 1-12, for grouping in the group-booking dialog. */
  gradeYear?: number | null;
  /** Teachers assigned to this student for the current year, if any. */
  teacherIds?: string[];
  /** The student's usual study place — new sessions default to it. */
  studyLocation?: "CENTER" | "HOME";
};
export type PackageOpt = { id: string; studentId: string; label: string };
export type Opt = { id: string; label: string };
export type PriceMatrix = Record<string, { CENTER: number | null; HOME: number | null }>;

export type SessionInit = {
  id: string;
  date: string;
  time?: string;
  studentId: string;
  teacherId: string;
  gradeLevelId: string;
  location: "CENTER" | "HOME";
  hours: number;
  paymentStatus: string;
  notes: string | null;
  packageId?: string | null;
  subjectId?: string | null;
};

type ActionFn = (
  prev: { ok?: boolean; error?: string },
  fd: FormData,
) => Promise<{ ok?: boolean; error?: string }>;

export function SessionDialog({
  title,
  trigger,
  action,
  students,
  teachers,
  levels,
  matrix,
  currency,
  packages = [],
  subjects = [],
  teacherSubjectIds = {},
  session,
  // Controlled-open + prefill support (used by the calendar's click-to-create).
  open: openProp,
  onOpenChange,
  defaultDate,
  defaultTime,
  defaultTeacherId,
  onSaved,
}: {
  title: string;
  trigger?: ReactNode;
  action: ActionFn;
  students: StudentOpt[];
  teachers: Opt[];
  levels: Opt[];
  matrix: PriceMatrix;
  currency: string;
  packages?: PackageOpt[];
  /** All active subjects, for the optional subject picker. */
  subjects?: Opt[];
  /** teacherId -> the subject ids that teacher teaches, to narrow the list. */
  teacherSubjectIds?: Record<string, string[]>;
  session?: SessionInit;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  defaultDate?: string;
  defaultTime?: string;
  defaultTeacherId?: string;
  onSaved?: () => void;
}) {
  const t = useTranslations("sessions");
  const tc = useTranslations("common");
  const te = useTranslations("enums");

  const controlled = openProp !== undefined;
  const [openState, setOpenState] = useState(false);
  const open = controlled ? openProp! : openState;
  const setOpen = (v: boolean) => {
    if (!controlled) setOpenState(v);
    onOpenChange?.(v);
  };

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const today = localToday();
  const now = localNowTime();
  const [studentId, setStudentId] = useState(session?.studentId ?? "");
  const [gradeLevelId, setGradeLevelId] = useState(session?.gradeLevelId ?? "");
  const [location, setLocation] = useState<"CENTER" | "HOME">(session?.location ?? "CENTER");
  const [hours, setHours] = useState<string>(session ? String(session.hours) : "1");
  const [packageId, setPackageId] = useState(session?.packageId ?? "");
  // Controlled so the conflict check can see them (they still post via `name`).
  const [date, setDate] = useState(session?.date ?? defaultDate ?? today);
  const [time, setTime] = useState(session?.time ?? defaultTime ?? now);
  const [teacherId, setTeacherId] = useState(session?.teacherId ?? defaultTeacherId ?? "");
  const [subjectId, setSubjectId] = useState(session?.subjectId ?? "");

  // When opened fresh for quick-create, reset the light fields.
  useEffect(() => {
    if (open && !session) {
      setStudentId("");
      setGradeLevelId("");
      setLocation("CENTER");
      setHours("1");
      setPackageId("");
      setDate(defaultDate ?? localToday());
      setTime(defaultTime ?? localNowTime());
      setTeacherId(defaultTeacherId ?? "");
      setSubjectId("");
      setError(null);
    }
    // `today` is stable for the life of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session, defaultDate, defaultTime, defaultTeacherId]);

  // Advisory only — never gates the save button.
  const conflictResults = useConflictCheck(
    {
      date,
      time,
      hours: parseFloat(hours) || 1,
      teacherId,
      studentIds: studentId ? [studentId] : [],
      excludeId: session?.id ?? null,
    },
    open,
  );
  const conflicts = conflictResults[0]?.conflicts ?? [];

  const studentPackages = useMemo(
    () => packages.filter((p) => p.studentId === studentId),
    [packages, studentId],
  );

  /**
   * Put the student's own teachers at the top once one is picked.
   *
   * The full roster stays available below — a cover lesson with another
   * teacher is normal, so this reorders rather than restricts.
   */
  const teacherOptions = useMemo(() => {
    const assigned = new Set(students.find((s) => s.id === studentId)?.teacherIds ?? []);
    if (assigned.size === 0) {
      return teachers.map((tt) => ({ value: tt.id, label: tt.label }));
    }
    const mine = teachers.filter((tt) => assigned.has(tt.id));
    const rest = teachers.filter((tt) => !assigned.has(tt.id));
    return [
      ...mine.map((tt) => ({ value: tt.id, label: tt.label, hint: t("assignedTag") })),
      ...rest.map((tt) => ({ value: tt.id, label: tt.label })),
    ];
  }, [teachers, students, studentId, t]);

  // Subjects offered in the picker: narrowed to the chosen teacher's subjects
  // when they have any, otherwise the full active list — a cover lesson can be
  // any subject, so this never becomes a dead end. Never restricts saving.
  const subjectOptions = useMemo(() => {
    const own = teacherId ? teacherSubjectIds[teacherId] : undefined;
    if (own && own.length) {
      const set = new Set(own);
      return subjects.filter((sbj) => set.has(sbj.id));
    }
    return subjects;
  }, [subjects, teacherSubjectIds, teacherId]);

  // If the picked subject isn't offered by the newly chosen teacher, keep it
  // only when it's the value already on an existing session (history), else clear.
  useEffect(() => {
    if (!subjectId) return;
    if (subjectOptions.some((sbj) => sbj.id === subjectId)) return;
    if (session?.subjectId === subjectId) return;
    setSubjectId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectOptions]);

  const pricePerHour = useMemo(() => {
    const row = matrix[gradeLevelId];
    return row ? (row[location] ?? 0) : 0;
  }, [matrix, gradeLevelId, location]);
  const total = pricePerHour * (parseFloat(hours) || 0);

  function onStudentChange(id: string) {
    setStudentId(id);
    const s = students.find((x) => x.id === id);
    if (s?.gradeLevelId) setGradeLevelId(s.gradeLevelId);
    // Default the location — and therefore the auto-price — from the student's
    // usual study place. Only on create: editing keeps the session's own value.
    if (!session && s?.studyLocation) setLocation(s.studyLocation);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const res = await action({}, fd);
      if (res.ok) {
        setOpen(false);
        onSaved?.();
      } else setError(res.error ?? "invalid");
    });
  }

  const body = (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <form key={String(open)} onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <FormField label={tc("date")} htmlFor="date">
            <Input
              id="date"
              name="date"
              type="date"
              dir="ltr"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </FormField>
          <FormField label={t("startTime")} htmlFor="time">
            <Input
              id="time"
              name="time"
              type="time"
              dir="ltr"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </FormField>
          <FormField label={t("hours")} htmlFor="hours">
            <Input
              id="hours"
              name="hours"
              type="number"
              step="0.5"
              min="0.5"
              dir="ltr"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              required
            />
          </FormField>
        </div>

        <FormField label={t("student")} htmlFor="studentId">
          <Combobox
            id="studentId"
            name="studentId"
            required
            options={students.map((s) => ({ value: s.id, label: s.name }))}
            value={studentId}
            onChange={onStudentChange}
          />
        </FormField>

        <FormField label={t("teacher")} htmlFor="teacherId">
          <Combobox
            id="teacherId"
            name="teacherId"
            required
            options={teacherOptions}
            value={teacherId}
            onChange={setTeacherId}
          />
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("gradeLevel")} htmlFor="gradeLevelId">
            <Select
              id="gradeLevelId"
              name="gradeLevelId"
              value={gradeLevelId}
              onChange={(e) => setGradeLevelId(e.target.value)}
              required
            >
              <option value="">—</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </Select>
          </FormField>
          <FormField label={t("location")} htmlFor="location">
            <Select
              id="location"
              name="location"
              value={location}
              onChange={(e) => setLocation(e.target.value as "CENTER" | "HOME")}
            >
              <option value="CENTER">{te("location.CENTER")}</option>
              <option value="HOME">{te("location.HOME")}</option>
            </Select>
          </FormField>
        </div>

        {subjects.length > 0 && (
          <FormField label={t("subject")} htmlFor="subjectId" hint={t("subjectHint")}>
            <Select
              id="subjectId"
              name="subjectId"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              <option value="">{t("subjectNone")}</option>
              {subjectOptions.map((sbj) => (
                <option key={sbj.id} value={sbj.id}>{sbj.label}</option>
              ))}
            </Select>
          </FormField>
        )}

        <FormField label={t("paymentStatus")} htmlFor="paymentStatus">
          <Select id="paymentStatus" name="paymentStatus" defaultValue={session?.paymentStatus ?? "UNPAID"}>
            <option value="UNPAID">{te("paymentStatus.UNPAID")}</option>
            <option value="PARTIAL">{te("paymentStatus.PARTIAL")}</option>
            <option value="PAID">{te("paymentStatus.PAID")}</option>
          </Select>
        </FormField>

        {/* Covering the session with a prepaid package: hours are drawn down when
            it is confirmed/checked out, and it is not charged again on the ledger. */}
        {studentPackages.length > 0 && (
          <FormField label={t("package")} htmlFor="packageId">
            <Select
              id="packageId"
              name="packageId"
              value={packageId}
              onChange={(e) => setPackageId(e.target.value)}
            >
              <option value="">—</option>
              {studentPackages.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </Select>
          </FormField>
        )}

        <ConflictWarnings conflicts={conflicts} />

        <div className="flex items-center justify-between rounded-md bg-accent/60 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            {t("pricePerHour")}: <span className="tabular-nums font-medium text-foreground">{formatMoney(pricePerHour)}</span> {currency}
          </span>
          <span className="font-semibold">
            {t("total")}: <span className="tabular-nums">{formatMoney(total)}</span> {currency}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t("priceAuto")}</p>

        {error && error !== "forbidden" && (
          <p className="text-sm text-destructive">{tc("required")}</p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("cancel")}</Button>
          </DialogClose>
          <Button type="submit" disabled={pending}>
            {pending ? tc("saving") : tc("save")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      {body}
    </Dialog>
  );
}
