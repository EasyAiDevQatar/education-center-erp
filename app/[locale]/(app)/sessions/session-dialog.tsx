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
import { formatMoney } from "@/lib/money";

export type StudentOpt = { id: string; name: string; gradeLevelId: string | null };
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

  const today = new Date().toISOString().slice(0, 10);
  const [studentId, setStudentId] = useState(session?.studentId ?? "");
  const [gradeLevelId, setGradeLevelId] = useState(session?.gradeLevelId ?? "");
  const [location, setLocation] = useState<"CENTER" | "HOME">(session?.location ?? "CENTER");
  const [hours, setHours] = useState<string>(session ? String(session.hours) : "1");

  // When opened fresh for quick-create, reset the light fields.
  useEffect(() => {
    if (open && !session) {
      setStudentId("");
      setGradeLevelId("");
      setLocation("CENTER");
      setHours("1");
      setError(null);
    }
  }, [open, session]);

  const pricePerHour = useMemo(() => {
    const row = matrix[gradeLevelId];
    return row ? (row[location] ?? 0) : 0;
  }, [matrix, gradeLevelId, location]);
  const total = pricePerHour * (parseFloat(hours) || 0);

  function onStudentChange(id: string) {
    setStudentId(id);
    const s = students.find((x) => x.id === id);
    if (s?.gradeLevelId) setGradeLevelId(s.gradeLevelId);
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
            <Input id="date" name="date" type="date" dir="ltr" defaultValue={session?.date ?? defaultDate ?? today} required />
          </FormField>
          <FormField label={t("startTime")} htmlFor="time">
            <Input id="time" name="time" type="time" dir="ltr" defaultValue={session?.time ?? defaultTime ?? "16:00"} />
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
          <Select
            id="studentId"
            name="studentId"
            value={studentId}
            onChange={(e) => onStudentChange(e.target.value)}
            required
          >
            <option value="">—</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </FormField>

        <FormField label={t("teacher")} htmlFor="teacherId">
          <Select id="teacherId" name="teacherId" defaultValue={session?.teacherId ?? defaultTeacherId ?? ""} required>
            <option value="">—</option>
            {teachers.map((tt) => (
              <option key={tt.id} value={tt.id}>{tt.label}</option>
            ))}
          </Select>
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

        <FormField label={t("paymentStatus")} htmlFor="paymentStatus">
          <Select id="paymentStatus" name="paymentStatus" defaultValue={session?.paymentStatus ?? "UNPAID"}>
            <option value="UNPAID">{te("paymentStatus.UNPAID")}</option>
            <option value="PARTIAL">{te("paymentStatus.PARTIAL")}</option>
            <option value="PAID">{te("paymentStatus.PAID")}</option>
          </Select>
        </FormField>

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
