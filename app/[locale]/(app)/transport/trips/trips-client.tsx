"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SortableTableHeader,
  useTableSortFilter,
  type ColumnDef,
} from "@/components/ui/table-sort";
import { usePagination, TablePagination } from "@/components/ui/table-pagination";
import { TableSearch, useTableSearch } from "@/components/ui/table-search";
import { minToHHMM } from "@/lib/planner";
import { TRIP_STATUSES } from "@/lib/enums";

export type TripRow = {
  id: string;
  date: string;
  status: string;
  driverName: string | null;
  plate: string | null;
  passengerName: string | null;
  fromLabel: string;
  toLabel: string;
  plannedStartMin: number;
  plannedEndMin: number;
  estimatedKm: number;
  autoAllocated: boolean;
  stopCount: number;
};

function statusVariant(status: string) {
  if (status === "PROPOSED") return "warning" as const;
  if (status === "STARTED" || status === "COMPLETED") return "success" as const;
  if (status === "CANCELLED") return "muted" as const;
  return "default" as const;
}

export function TripsClient({
  trips,
  filters,
}: {
  trips: TripRow[];
  filters: { from: string; to: string; status: string };
}) {
  const t = useTranslations("trips");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const router = useRouter();
  const pathname = usePathname();

  const search = useTableSearch(trips, (x) => [
    x.passengerName,
    x.driverName,
    x.plate,
    x.fromLabel,
    x.toLabel,
  ]);

  const columns = useMemo<ColumnDef<TripRow>[]>(
    () => [
      { key: "date", label: tc("date"), type: "date", value: (x) => x.date },
      { key: "time", label: t("time") },
      { key: "passenger", label: t("passenger"), value: (x) => x.passengerName, filterable: true },
      { key: "route", label: t("route") },
      { key: "driver", label: t("driver"), value: (x) => x.driverName, filterable: true },
      { key: "vehicle", label: t("vehicle"), value: (x) => x.plate, filterable: true },
      { key: "km", label: t("km"), type: "number", value: (x) => x.estimatedKm, className: "text-end" },
      {
        key: "status",
        label: tc("status"),
        type: "enum",
        value: (x) => x.status,
        filterable: true,
        options: [...TRIP_STATUSES],
        optionLabel: (v) => te(`tripStatus.${v}`),
      },
    ],
    [t, tc, te],
  );
  const sf = useTableSortFilter(search.filtered, columns);
  const pg = usePagination(sf.rows, 20, sf.version);

  function applyFilters(form: HTMLFormElement) {
    const fd = new FormData(form);
    const params = new URLSearchParams();
    for (const key of ["from", "to", "status"]) {
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
          <label className="text-xs text-muted-foreground">{tc("status")}</label>
          <Select name="status" defaultValue={filters.status} className="w-40">
            <option value="">{tc("all")}</option>
            {TRIP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {te(`tripStatus.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          {tc("filter")}
        </Button>
      </form>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <SortableTableHeader sf={sf} />
          </TableHeader>
          <TableBody>
            {pg.total === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="tabular-nums">
                  <span dir="ltr">{x.date}</span>
                </TableCell>
                <TableCell className="tabular-nums">
                  <span dir="ltr">
                    {minToHHMM(x.plannedStartMin)}–{minToHHMM(x.plannedEndMin)}
                  </span>
                </TableCell>
                <TableCell className="font-medium">{x.passengerName ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {x.fromLabel} → {x.toLabel}
                </TableCell>
                <TableCell>{x.driverName ?? "—"}</TableCell>
                <TableCell>
                  <span dir="ltr">{x.plate ?? "—"}</span>
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {x.estimatedKm.toFixed(1)}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(x.status)}>
                    {te(`tripStatus.${x.status}`)}
                  </Badge>
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
