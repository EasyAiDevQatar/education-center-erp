"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Plus,
  Pencil,
  Trash2,
  Phone,
  CalendarClock,
  UserPlus,
  GraduationCap,
} from "lucide-react";
import { useRouter, Link } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LEAD_BOARD_ORDER, followUpState, funnelCounts, type LeadStatus } from "@/lib/leads";
import { saveLead, moveLead, deleteLead, convertLead, bookTrialSession } from "./actions";

export type LeadRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  status: string;
  notes: string | null;
  gradeLevelId: string | null;
  gradeLabel: string | null;
  followUpAt: string | null;
  studentId: string | null;
  trialCount: number;
};

type Opt = { id: string; label: string };

const COLUMN_TONE: Record<string, string> = {
  NEW: "border-primary/40",
  CONTACTED: "border-warning/50",
  TRIAL: "border-[var(--success)]/40",
  ENROLLED: "border-[var(--success)]/60",
  LOST: "border-border",
};

export function LeadsBoard({
  leads,
  levels,
  teachers,
  today,
}: {
  leads: LeadRow[];
  levels: Opt[];
  teachers: Opt[];
  today: string;
}) {
  const t = useTranslations("leads");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<LeadRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [converting, setConverting] = useState<LeadRow | null>(null);
  const [trialFor, setTrialFor] = useState<LeadRow | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<string | null>(null);

  const funnel = useMemo(() => funnelCounts(leads), [leads]);
  const byStatus = useMemo(() => {
    const m = new Map<string, LeadRow[]>();
    for (const s of LEAD_BOARD_ORDER) m.set(s, []);
    for (const l of leads) {
      if (!m.has(l.status)) m.set(l.status, []);
      m.get(l.status)!.push(l);
    }
    return m;
  }, [leads]);

  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {/* Funnel summary */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
        <Button size="sm" className="gap-1" onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          {t("addLead")}
        </Button>
        <div className="ms-auto flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="default">{t("total")}: {funnel.total}</Badge>
          <Badge variant="success">{t("statuses.ENROLLED")}: {funnel.enrolled}</Badge>
          <Badge variant="destructive">{t("statuses.LOST")}: {funnel.lost}</Badge>
          <Badge variant="warning">{t("conversionRate")}: {funnel.conversionRate}%</Badge>
        </div>
      </div>

      <p className="px-1 text-xs text-muted-foreground">{t("dragHint")}</p>

      {/* Board */}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {LEAD_BOARD_ORDER.map((status) => {
          const items = byStatus.get(status) ?? [];
          return (
            <div
              key={status}
              className={cn(
                "rounded-lg border-2 bg-card p-2 transition-colors",
                COLUMN_TONE[status],
                dragId && hoverCol === status && "bg-primary/5",
              )}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (hoverCol !== status) setHoverCol(status);
              }}
              onDragLeave={() => setHoverCol((h) => (h === status ? null : h))}
              onDrop={(e) => {
                e.preventDefault();
                const id = dragId;
                setDragId(null);
                setHoverCol(null);
                if (!id) return;
                const lead = leads.find((l) => l.id === id);
                if (!lead || lead.status === status) return;
                run(() => moveLead(locale, { id, status: status as LeadStatus }));
              }}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-semibold">{t(`statuses.${status}`)}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
                  {items.length}
                </span>
              </div>

              <div className="space-y-2">
                {items.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">{tc("noData")}</p>
                )}
                {items.map((l) => {
                  const fu = followUpState(l.followUpAt, l.status, today);
                  return (
                    <div
                      key={l.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", l.id);
                        setDragId(l.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setHoverCol(null);
                      }}
                      className={cn(
                        "cursor-grab rounded-md border border-border bg-background p-2 text-sm active:cursor-grabbing",
                        dragId === l.id && "opacity-40 ring-2 ring-ring",
                        fu === "overdue" && "border-destructive",
                        fu === "dueToday" && "border-warning",
                      )}
                    >
                      <div className="font-medium">{l.name}</div>

                      {l.phone && (
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <Phone className="size-3" />
                          <span dir="ltr" className="tabular-nums">{l.phone}</span>
                        </div>
                      )}
                      {l.gradeLabel && (
                        <div className="mt-0.5 text-xs text-muted-foreground">{l.gradeLabel}</div>
                      )}
                      {l.source && (
                        <div className="mt-0.5 text-xs text-muted-foreground">{l.source}</div>
                      )}

                      {l.followUpAt && fu !== "none" && (
                        <div
                          className={cn(
                            "mt-1 inline-flex items-center gap-1 text-xs",
                            fu === "overdue" && "font-medium text-destructive",
                            fu === "dueToday" && "font-medium text-warning",
                            fu === "upcoming" && "text-muted-foreground",
                          )}
                        >
                          <CalendarClock className="size-3" />
                          <span dir="ltr" className="tabular-nums">{l.followUpAt}</span>
                          {fu === "overdue" && <span>· {t("overdue")}</span>}
                          {fu === "dueToday" && <span>· {t("dueToday")}</span>}
                        </div>
                      )}

                      {l.trialCount > 0 && (
                        <div className="mt-1">
                          <Badge variant="success">{t("trialCount", { n: l.trialCount })}</Badge>
                        </div>
                      )}

                      <div className="mt-1.5 flex flex-wrap justify-end gap-0.5">
                        {l.status !== "ENROLLED" && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label={t("bookTrial")}
                              title={t("bookTrial")}
                              disabled={pending}
                              onClick={() => setTrialFor(l)}
                            >
                              <GraduationCap className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label={t("convert")}
                              title={t("convert")}
                              disabled={pending}
                              onClick={() => setConverting(l)}
                            >
                              <UserPlus className="size-3.5" />
                            </Button>
                          </>
                        )}
                        {l.status === "ENROLLED" && l.studentId && (
                          <Link
                            href={`/students/${l.studentId}`}
                            className="inline-flex size-7 items-center justify-center rounded-md text-primary hover:bg-accent"
                            aria-label={t("openStudent")}
                            title={t("openStudent")}
                          >
                            <UserPlus className="size-3.5" />
                          </Link>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={tc("edit")}
                          disabled={pending}
                          onClick={() => setEditing(l)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={tc("delete")}
                          disabled={pending}
                          onClick={() => run(() => deleteLead(locale, l.id))}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {(adding || editing) && (
        <LeadDialog
          lead={editing}
          levels={levels}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {converting && (
        <ConvertDialog
          lead={converting}
          levels={levels}
          onClose={() => setConverting(null)}
          onSaved={() => {
            setConverting(null);
            router.refresh();
          }}
        />
      )}

      {trialFor && (
        <TrialDialog
          lead={trialFor}
          levels={levels}
          teachers={teachers}
          today={today}
          onClose={() => setTrialFor(null)}
          onSaved={() => {
            setTrialFor(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ---------------- dialogs ---------------- */

function LeadDialog({
  lead,
  levels,
  onClose,
  onSaved,
}: {
  lead: LeadRow | null;
  levels: Opt[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("leads");
  const tc = useTranslations("common");
  const locale = useLocale();

  const [name, setName] = useState(lead?.name ?? "");
  const [phone, setPhone] = useState(lead?.phone ?? "");
  const [email, setEmail] = useState(lead?.email ?? "");
  const [source, setSource] = useState(lead?.source ?? "");
  const [status, setStatus] = useState(lead?.status ?? "NEW");
  const [gradeLevelId, setGradeLevelId] = useState(lead?.gradeLevelId ?? "");
  const [followUpAt, setFollowUpAt] = useState(lead?.followUpAt ?? "");
  const [notes, setNotes] = useState(lead?.notes ?? "");
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const res = await saveLead(locale, lead?.id ?? null, {
        name,
        phone,
        email,
        source,
        status: status as LeadStatus,
        gradeLevelId,
        followUpAt: followUpAt || null,
        notes,
      });
      if (res.ok) onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{lead ? t("editLead") : t("addLead")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label={tc("name")} htmlFor="l-name">
            <Input id="l-name" value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={tc("phone")} htmlFor="l-phone">
              <Input id="l-phone" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </FormField>
            <FormField label={tc("email")} htmlFor="l-email">
              <Input id="l-email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("source")} htmlFor="l-source" hint={t("sourceHint")}>
              <Input id="l-source" value={source} onChange={(e) => setSource(e.target.value)} />
            </FormField>
            <FormField label={tc("status")} htmlFor="l-status">
              <Select id="l-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                {LEAD_BOARD_ORDER.map((s) => (
                  <option key={s} value={s}>{t(`statuses.${s}`)}</option>
                ))}
              </Select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("gradeLevel")} htmlFor="l-grade">
              <Select id="l-grade" value={gradeLevelId} onChange={(e) => setGradeLevelId(e.target.value)}>
                <option value="">—</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </Select>
            </FormField>
            <FormField label={t("followUpAt")} htmlFor="l-follow">
              <Input
                id="l-follow"
                type="date"
                dir="ltr"
                value={followUpAt}
                onChange={(e) => setFollowUpAt(e.target.value)}
              />
            </FormField>
          </div>
          <FormField label={tc("notes")} htmlFor="l-notes">
            <Input id="l-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("cancel")}</Button>
          </DialogClose>
          <Button type="button" disabled={pending || !name.trim()} onClick={submit}>
            {pending ? tc("saving") : tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConvertDialog({
  lead,
  levels,
  onClose,
  onSaved,
}: {
  lead: LeadRow;
  levels: Opt[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("leads");
  const tc = useTranslations("common");
  const locale = useLocale();

  const [gradeLevelId, setGradeLevelId] = useState(lead.gradeLevelId ?? "");
  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState(lead.phone ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    start(async () => {
      const res = await convertLead(locale, {
        leadId: lead.id,
        gradeLevelId,
        guardianName: guardianName || null,
        guardianPhone: guardianPhone || null,
      });
      if (res.ok) onSaved();
      else setError(res.error ?? "invalid");
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("convertTitle", { name: lead.name })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {lead.trialCount > 0 ? t("convertHintWithTrials") : t("convertHint")}
          </p>
          <FormField label={t("gradeLevel")} htmlFor="c-grade">
            <Select id="c-grade" value={gradeLevelId} onChange={(e) => setGradeLevelId(e.target.value)}>
              <option value="">—</option>
              {levels.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </Select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("guardianName")} htmlFor="c-gname" hint={t("guardianOptional")}>
              <Input id="c-gname" value={guardianName} onChange={(e) => setGuardianName(e.target.value)} />
            </FormField>
            <FormField label={t("guardianPhone")} htmlFor="c-gphone">
              <Input id="c-gphone" dir="ltr" value={guardianPhone} onChange={(e) => setGuardianPhone(e.target.value)} />
            </FormField>
          </div>
          {error && <p className="text-sm text-destructive">{t(`errors.${error}`)}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("cancel")}</Button>
          </DialogClose>
          <Button type="button" disabled={pending} onClick={submit}>
            {pending ? tc("saving") : t("convert")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TrialDialog({
  lead,
  levels,
  teachers,
  today,
  onClose,
  onSaved,
}: {
  lead: LeadRow;
  levels: Opt[];
  teachers: Opt[];
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("leads");
  const ts = useTranslations("sessions");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();

  const [date, setDate] = useState(today);
  const [time, setTime] = useState("16:00");
  const [teacherId, setTeacherId] = useState(teachers[0]?.id ?? "");
  const [gradeLevelId, setGradeLevelId] = useState(lead.gradeLevelId ?? levels[0]?.id ?? "");
  const [location, setLocation] = useState<"CENTER" | "HOME">("CENTER");
  const [hours, setHours] = useState("1");
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const res = await bookTrialSession(locale, {
        leadId: lead.id,
        date,
        time,
        teacherId,
        gradeLevelId,
        location,
        hours: parseFloat(hours) || 1,
      });
      if (res.ok) onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("trialTitle", { name: lead.name })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("trialHint")}</p>
          <div className="grid grid-cols-3 gap-3">
            <FormField label={tc("date")} htmlFor="tr-date">
              <Input id="tr-date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormField>
            <FormField label={ts("startTime")} htmlFor="tr-time">
              <Input id="tr-time" type="time" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} />
            </FormField>
            <FormField label={ts("hours")} htmlFor="tr-hours">
              <Input
                id="tr-hours"
                type="number"
                step="0.5"
                min="0.5"
                dir="ltr"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </FormField>
          </div>
          <FormField label={ts("teacher")} htmlFor="tr-teacher">
            <Select id="tr-teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
              {teachers.map((x) => (
                <option key={x.id} value={x.id}>{x.label}</option>
              ))}
            </Select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={ts("gradeLevel")} htmlFor="tr-grade">
              <Select id="tr-grade" value={gradeLevelId} onChange={(e) => setGradeLevelId(e.target.value)}>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </Select>
            </FormField>
            <FormField label={ts("location")} htmlFor="tr-loc">
              <Select
                id="tr-loc"
                value={location}
                onChange={(e) => setLocation(e.target.value as "CENTER" | "HOME")}
              >
                <option value="CENTER">{te("location.CENTER")}</option>
                <option value="HOME">{te("location.HOME")}</option>
              </Select>
            </FormField>
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("cancel")}</Button>
          </DialogClose>
          <Button type="button" disabled={pending || !teacherId || !gradeLevelId} onClick={submit}>
            {pending ? tc("saving") : t("bookTrial")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
