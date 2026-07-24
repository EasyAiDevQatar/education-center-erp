"use client";

import { useMemo, useState } from "react";

import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, Download, Users, Eye } from "lucide-react";
import { useRouter, usePathname, Link } from "@/i18n/navigation";
import { GroupBookingDialog, type GroupOpt } from "./group-booking-dialog";
import { DeleteButton } from "@/components/crud/delete-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePagination, TablePagination } from "@/components/ui/table-pagination";
import {
  useTableSortFilter,
  SortableTableHeader,
  type ColumnDef,
} from "@/components/ui/table-sort";
import { TableSearch, useTableSearch } from "@/components/ui/table-search";
import { QuickPayDialog } from "../payments/quick-pay-dialog";
import { formatMoney, formatHours } from "@/lib/money";
import {
  SessionDialog,
  type StudentOpt,
  type Opt,
  type PriceMatrix,
  type SessionInit,
  type PackageOpt,
} from "./session-dialog";
import { saveSession, deleteSession } from "./actions";
import { TripPromptDialog, type TripPromptInfo } from "@/components/trip-prompt-dialog";

export type SessionRow = SessionInit & {
  studentName: string;
  teacherName: string;
  levelLabel: string;
  subjectLabel: string | null;
  pricePerHour: number;
  total: number;
};

export type Filters = { from: string; to: string; teacherId: string; status: string };

function statusBadge(status: string) {
  if (status === "PAID") return "success" as const;
  if (status === "PARTIAL") return "warning" as const;
  return "muted" as const;
}

export function SessionsClient({
  sessions,
  students,
  teachers,
  levels,
  matrix,
  currency,
  packages = [],
  subjects = [],
  groups = [],
  teacherSubjectIds = {},
  filters,
  exportHref,
}: {
  sessions: SessionRow[];
  students: StudentOpt[];
  teachers: Opt[];
  levels: Opt[];
  matrix: PriceMatrix;
  currency: string;
  packages?: PackageOpt[];
  subjects?: Opt[];
  groups?: GroupOpt[];
  teacherSubjectIds?: Record<string, string[]>;
  filters: Filters;
  exportHref: string;
}) {
  const t = useTranslations("sessions");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const tg = useTranslations("group");
  const locale = useLocale();
  const router = useRouter();
  // Group picked inside the add-session dialog; opens group booking preloaded.
  const [handoffGroup, setHandoffGroup] = useState<string | null>(null);
  const [tripPrompt, setTripPrompt] = useState<TripPromptInfo | null>(null);
  const pathname = usePathname();
  const search = useTableSearch(sessions, (x) => [
    x.studentName,
    x.teacherName,
    x.levelLabel,
    x.subjectLabel,
    x.date,
    x.notes,
  ]);
  const columns = useMemo<ColumnDef<SessionRow>[]>(
    () => [
      { key: "date", label: tc("date"), type: "date", value: (s) => s.date },
      { key: "time", label: t("time"), value: (s) => s.time ?? "" },
      { key: "student", label: t("student"), value: (s) => s.studentName, filterable: true },
      { key: "teacher", label: t("teacher"), value: (s) => s.teacherName, filterable: true },
      { key: "level", label: t("gradeLevel"), value: (s) => s.levelLabel, filterable: true },
      { key: "subject", label: t("subject"), value: (s) => s.subjectLabel, filterable: true },
      {
        key: "location",
        label: t("location"),
        type: "enum",
        value: (s) => s.location,
        filterable: true,
        options: ["CENTER", "HOME"],
        optionLabel: (v) => te(`location.${v}`),
      },
      { key: "hours", label: t("hours"), type: "number", value: (s) => s.hours },
      { key: "total", label: t("total"), type: "number", value: (s) => s.total },
      {
        key: "paymentStatus",
        label: t("paymentStatus"),
        type: "enum",
        value: (s) => s.paymentStatus,
        filterable: true,
        options: ["PAID", "PARTIAL", "UNPAID"],
        optionLabel: (v) => te(`paymentStatus.${v}`),
      },
      { key: "actions", label: tc("actions") },
    ],
    [t, tc, te],
  );
  const sf = useTableSortFilter(search.filtered, columns);
  const pg = usePagination(sf.rows, 20, sf.version);

  function applyFilters(form: HTMLFormElement) {
    const fd = new FormData(form);
    const params = new URLSearchParams();
    for (const key of ["from", "to", "teacherId", "status"]) {
      const v = String(fd.get(key) ?? "");
      if (v) params.set(key, v);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <>
      <div className="mb-3">
        <TableSearch
          value={search.query}
          onChange={search.setQuery}
          resultCount={search.filtered.length}
          placeholder={t("searchPlaceholder")}
        />
      </div>

      {/* Filter bar */}
      <form
        className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault();
          applyFilters(e.currentTarget);
        }}
      >
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{tc("from")}</label>
          <Input name="from" type="date" dir="ltr" defaultValue={filters.from} className="w-40" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{tc("to")}</label>
          <Input name="to" type="date" dir="ltr" defaultValue={filters.to} className="w-40" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t("teacher")}</label>
          <Select name="teacherId" defaultValue={filters.teacherId} className="w-40">
            <option value="">{tc("all")}</option>
            {teachers.map((tt) => (
              <option key={tt.id} value={tt.id}>{tt.label}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t("paymentStatus")}</label>
          <Select name="status" defaultValue={filters.status} className="w-36">
            <option value="">{tc("all")}</option>
            <option value="PAID">{te("paymentStatus.PAID")}</option>
            <option value="PARTIAL">{te("paymentStatus.PARTIAL")}</option>
            <option value="UNPAID">{te("paymentStatus.UNPAID")}</option>
          </Select>
        </div>
        <Button type="submit" variant="secondary">{tc("filter")}</Button>
        <a href={exportHref} className="ms-auto">
          <Button type="button" variant="outline" className="gap-2">
            <Download className="size-4" />
            {tc("export")}
          </Button>
        </a>
        <GroupBookingDialog
          students={students}
          teachers={teachers}
          levels={levels}
          groups={groups}
          matrix={matrix}
          currency={currency}
          onSaved={() => router.refresh()}
          trigger={
            <Button variant="secondary" className="gap-2">
              <Users className="size-4" />
              {tg("title")}
            </Button>
          }
        />
        <SessionDialog
          title={t("add")}
          action={saveSession.bind(null, locale, null)}
          students={students}
          teachers={teachers}
          levels={levels}
          matrix={matrix}
          currency={currency}
          packages={packages}
          subjects={subjects}
          teacherSubjectIds={teacherSubjectIds}
          groups={groups}
          onPickGroup={setHandoffGroup}
          onHomeNeedsTrip={setTripPrompt}
          trigger={
            <Button className="gap-2">
              <Plus className="size-4" />
              {t("add")}
            </Button>
          }
        />
        <GroupBookingDialog
          students={students}
          teachers={teachers}
          levels={levels}
          groups={groups}
          matrix={matrix}
          currency={currency}
          open={!!handoffGroup}
          initialGroupId={handoffGroup ?? undefined}
          onOpenChange={(v) => { if (!v) setHandoffGroup(null); }}
          onSaved={() => router.refresh()}
        />
        <TripPromptDialog info={tripPrompt} onClose={() => setTripPrompt(null)} />
      </form>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <SortableTableHeader sf={sf} />
          </TableHeader>
          <TableBody>
            {pg.total === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="tabular-nums"><span dir="ltr">{s.date}</span></TableCell>
                <TableCell className="tabular-nums"><span dir="ltr">{s.time ?? "—"}</span></TableCell>
                <TableCell className="font-medium">{s.studentName}</TableCell>
                <TableCell>{s.teacherName}</TableCell>
                <TableCell>{s.levelLabel}</TableCell>
                <TableCell>
                  {s.subjectLabel ? (
                    <Badge variant="default">{s.subjectLabel}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>{te(`location.${s.location}`)}</TableCell>
                <TableCell className="tabular-nums">{formatHours(s.hours)}</TableCell>
                <TableCell className="tabular-nums">{formatMoney(s.total)} {currency}</TableCell>
                <TableCell>
                  <Badge variant={statusBadge(s.paymentStatus)}>
                    {te(`paymentStatus.${s.paymentStatus}`)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-center gap-1">
                    {s.paymentStatus !== "PAID" && (
                      <QuickPayDialog
                        studentId={s.studentId}
                        studentName={s.studentName}
                        amount={s.total}
                        currency={currency}
                        teachers={teachers}
                      />
                    )}
                    <Link
                      href={`/sessions/${s.id}`}
                      aria-label={t("view360")}
                      title={t("view360")}
                      className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                    >
                      <Eye className="size-4" />
                    </Link>
                    <SessionDialog
                      title={t("edit")}
                      action={saveSession.bind(null, locale, s.id)}
                      students={students}
                      teachers={teachers}
                      levels={levels}
                      matrix={matrix}
                      currency={currency}
                      packages={packages}
                      subjects={subjects}
                      teacherSubjectIds={teacherSubjectIds}
                      session={s}
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    <DeleteButton action={deleteSession.bind(null, locale, s.id)} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination {...pg} />
      </div>
    </>
  );
}
