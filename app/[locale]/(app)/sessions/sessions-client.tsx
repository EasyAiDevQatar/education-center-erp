"use client";

import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, Download, Users } from "lucide-react";
import { useRouter, usePathname } from "@/i18n/navigation";
import { GroupBookingDialog } from "./group-booking-dialog";
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

export type SessionRow = SessionInit & {
  studentName: string;
  teacherName: string;
  levelLabel: string;
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
  filters: Filters;
  exportHref: string;
}) {
  const t = useTranslations("sessions");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const tg = useTranslations("group");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useTableSearch(sessions, (x) => [
    x.studentName,
    x.teacherName,
    x.levelLabel,
    x.date,
    x.notes,
  ]);
  const pg = usePagination(search.filtered);

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
          trigger={
            <Button className="gap-2">
              <Plus className="size-4" />
              {t("add")}
            </Button>
          }
        />
      </form>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tc("date")}</TableHead>
              <TableHead>{t("student")}</TableHead>
              <TableHead>{t("teacher")}</TableHead>
              <TableHead>{t("gradeLevel")}</TableHead>
              <TableHead>{t("location")}</TableHead>
              <TableHead className="text-end">{t("hours")}</TableHead>
              <TableHead className="text-end">{t("total")}</TableHead>
              <TableHead>{t("paymentStatus")}</TableHead>
              <TableHead className="text-end">{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((s) => (
              <TableRow key={s.id}>
                <TableCell dir="ltr" className="text-start tabular-nums">{s.date}</TableCell>
                <TableCell className="font-medium">{s.studentName}</TableCell>
                <TableCell>{s.teacherName}</TableCell>
                <TableCell>{s.levelLabel}</TableCell>
                <TableCell>{te(`location.${s.location}`)}</TableCell>
                <TableCell className="text-end tabular-nums">{formatHours(s.hours)}</TableCell>
                <TableCell className="text-end tabular-nums">{formatMoney(s.total)} {currency}</TableCell>
                <TableCell>
                  <Badge variant={statusBadge(s.paymentStatus)}>
                    {te(`paymentStatus.${s.paymentStatus}`)}
                  </Badge>
                </TableCell>
                <TableCell className="text-end">
                  <div className="flex justify-end gap-1">
                    {s.paymentStatus !== "PAID" && (
                      <QuickPayDialog
                        studentId={s.studentId}
                        studentName={s.studentName}
                        amount={s.total}
                        currency={currency}
                        teachers={teachers}
                      />
                    )}
                    <SessionDialog
                      title={t("edit")}
                      action={saveSession.bind(null, locale, s.id)}
                      students={students}
                      teachers={teachers}
                      levels={levels}
                      matrix={matrix}
                      currency={currency}
                      packages={packages}
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
