"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Printer } from "lucide-react";
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
import { Select } from "@/components/ui/select";
import { minToHHMM } from "@/lib/planner";
import { weekdayOf } from "@/lib/conflicts";
import { normalizeArabic } from "@/components/ui/table-search";
import { Input } from "@/components/ui/input";
import { timetableData, type TimetablePerson } from "./timetable-actions";

type Opt = { id: string; label: string };
type Scope = "day" | "week";
type Kind = "student" | "teacher";

function addDaysStr(s: string, n: number) {
  const d = new Date(`${s}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The week containing `day`, Sunday-first.
 *
 * `weekdayOf` returns 0 = Sunday, which matches the Gulf working week the rest
 * of the planner is built around.
 */
function weekRange(day: string): [string, string] {
  const start = addDaysStr(day, -weekdayOf(day));
  return [start, addDaysStr(start, 6)];
}

export type TimetableRequest = {
  kind: Kind;
  scope: Scope;
  from: string;
  to: string;
  people: TimetablePerson[];
};

/* ------------------------------------------------------------------ dialog */

export function TimetableDialog({
  day,
  students,
  teachers,
  onReady,
  onClose,
}: {
  day: string;
  students: Opt[];
  teachers: Opt[];
  /** Hands the fetched data back so the caller can render and print it. */
  onReady: (req: TimetableRequest) => void;
  onClose: () => void;
}) {
  const t = useTranslations("planner");
  const tc = useTranslations("common");
  const locale = useLocale();

  const [kind, setKind] = useState<Kind>("student");
  const [scope, setScope] = useState<Scope>("week");
  const [ids, setIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Switching between students and teachers must clear the selection: the ids
  // belong to the other table and would silently fetch nothing.
  const people = kind === "student" ? students : teachers;
  const switchKind = (k: Kind) => {
    setKind(k);
    setIds([]);
    setQuery("");
  };

  const shown = useMemo(() => {
    const q = normalizeArabic(query.trim());
    if (!q) return people;
    return people.filter((p) => normalizeArabic(p.label).includes(q));
  }, [people, query]);

  const [from, to] = scope === "week" ? weekRange(day) : [day, day];

  const toggle = (id: string) =>
    setIds((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : people.filter((p) => p.id === id || prev.includes(p.id)).map((p) => p.id),
    );

  function run() {
    setError(null);
    start(async () => {
      const res = await timetableData(locale, { kind, ids, from, to });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onReady({ kind, scope, from, to, people: res.people });
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("timetableTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label={t("timetableFor")} htmlFor="tt-kind">
              <Select id="tt-kind" value={kind} onChange={(e) => switchKind(e.target.value as Kind)}>
                <option value="student">{t("timetableStudents")}</option>
                <option value="teacher">{t("timetableTeachers")}</option>
              </Select>
            </FormField>
            <FormField label={t("timetableScope")} htmlFor="tt-scope" hint={`${from} → ${to}`}>
              <Select id="tt-scope" value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                <option value="week">{t("timetableWeekly")}</option>
                <option value="day">{t("timetableDaily")}</option>
              </Select>
            </FormField>
          </div>

          <FormField label={tc("search")} htmlFor="tt-q">
            <Input
              id="tt-q"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tc("searchPlaceholder")}
            />
          </FormField>

          <div className="mb-1 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setIds(shown.map((p) => p.id))}
            >
              {tc("selectAll")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setIds([])}>
              {tc("clear")}
            </Button>
          </div>

          <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-border p-2">
            {shown.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">{tc("noResults")}</p>
            )}
            {shown.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={ids.includes(p.id)}
                  onChange={() => toggle(p.id)}
                />
                <span className="truncate">{p.label}</span>
              </label>
            ))}
          </div>

          <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
            {t("timetableSummary", { count: ids.length })}
          </p>

          {error && <p className="text-sm text-destructive">{t(`timetableErrors.${error}`)}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {tc("cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            className="gap-1"
            disabled={pending || ids.length === 0}
            onClick={run}
          >
            <Printer className="size-4" />
            {pending ? tc("loading") : tc("print")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------- sheet */

/**
 * One printed timetable per person, each starting a new page.
 *
 * Handed to a family or a teacher rather than kept at the desk, so it carries a
 * header identifying the centre and a footer saying when it was produced, by
 * whom, and that a plan can change — a printed schedule outlives the data it
 * came from and will be waved at reception weeks later.
 */
export function TimetableSheet({
  req,
  centerName,
  centerLogo,
  printedBy,
}: {
  req: TimetableRequest;
  centerName: string;
  centerLogo: string;
  printedBy: string;
}) {
  const t = useTranslations("planner");
  const te = useTranslations("enums");
  const tc = useTranslations("common");
  const locale = useLocale();

  const printedAt = new Date().toLocaleString(locale === "ar" ? "ar-QA" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div data-print="A4P" className="hidden print:block">
      {req.people.map((person, i) => {
        // Group a week into days; a single day is just one group.
        const days = new Map<string, typeof person.entries>();
        for (const e of person.entries) {
          if (!days.has(e.date)) days.set(e.date, []);
          days.get(e.date)!.push(e);
        }

        return (
          <section
            key={person.id}
            // Every person starts a fresh page, except the last — a trailing
            // break leaves a blank sheet in the printer.
            className={i < req.people.length - 1 ? "break-after-page" : undefined}
          >
            <header className="mb-2 flex items-center justify-between gap-3 border-b-2 border-black pb-2">
              <div className="flex items-center gap-2">
                {centerLogo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={centerLogo} alt="" className="max-h-10 object-contain" />
                )}
                <div>
                  <div className="text-sm font-bold">{centerName || tc("appShort")}</div>
                  <div className="text-[10px]">
                    {req.kind === "student" ? t("timetableStudentSheet") : t("timetableTeacherSheet")}
                  </div>
                </div>
              </div>
              <div className="text-end">
                <div className="text-base font-bold">{person.name}</div>
                <div className="text-[10px]" dir="ltr">
                  {req.from === req.to ? req.from : `${req.from} → ${req.to}`}
                </div>
              </div>
            </header>

            {person.entries.length === 0 ? (
              <p className="py-6 text-center text-sm">{t("timetableNoSessions")}</p>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="w-[18%] text-start">{tc("date")}</th>
                    <th className="w-[18%] text-start">{t("time")}</th>
                    <th className="text-start">
                      {req.kind === "student" ? t("teacher") : t("student")}
                    </th>
                    <th className="w-[16%] text-start">{t("level")}</th>
                    <th className="w-[20%] text-start">{t("location")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...days.entries()].map(([date, entries]) =>
                    entries.map((e, j) => (
                      <tr key={`${date}-${j}`}>
                        {/* The date spans its day's rows, so a week reads as
                            days rather than a flat list of lessons. */}
                        {j === 0 && (
                          <td rowSpan={entries.length} className="align-top">
                            <div className="font-bold">{te(`weekday.${weekdayOf(date)}`)}</div>
                            <div className="text-[10px]" dir="ltr">
                              {date}
                            </div>
                          </td>
                        )}
                        <td className="tabular-nums">
                          <span dir="ltr">
                            {minToHHMM(e.startMin)}–{minToHHMM(e.startMin + e.hours * 60)}
                          </span>
                        </td>
                        <td>{e.counterpart}</td>
                        <td>{e.levelLabel}</td>
                        <td>
                          {te(`location.${e.location}`)}
                          {e.location === "HOME" && e.homeCode ? ` · ${e.homeCode}` : ""}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            )}
          </section>
        );
      })}

      {/* Repeats on every printed page — see the A4P rules in globals.css. */}
      <footer className="print-footer">
        <span>{t("timetableDisclaimer")}</span>
        <span dir="auto">
          {t("timetablePrintedAt", { at: printedAt })} · {t("timetablePrintedBy", { by: printedBy })}
        </span>
      </footer>
    </div>
  );
}
