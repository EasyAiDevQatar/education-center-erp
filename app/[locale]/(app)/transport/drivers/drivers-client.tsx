"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, TriangleAlert } from "lucide-react";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { DeleteButton } from "@/components/crud/delete-button";
import { RowActions, ViewDialog } from "@/components/crud/row-actions";
import { FormField } from "@/components/crud/form-field";
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
import type { ExpiryLevel } from "@/lib/transport/fleet";
import { saveDriver, deleteDriver } from "./actions";

export type DriverRow = {
  id: string;
  employeeId: string;
  name: string;
  phone: string | null;
  jobTitle: string | null;
  licenceNo: string | null;
  licenceExpiry: string | null;
  licenceLevel: ExpiryLevel;
  defaultVehicleId: string | null;
  defaultVehiclePlate: string | null;
  shiftStartMin: number | null;
  shiftEndMin: number | null;
  active: boolean;
  notes: string | null;
};

export type EmployeeOpt = { id: string; label: string; jobTitle: string | null };
export type VehicleOpt = { id: string; plate: string };

function levelVariant(level: ExpiryLevel) {
  if (level === "expired") return "destructive" as const;
  if (level === "soon") return "warning" as const;
  if (level === "unknown") return "muted" as const;
  return "success" as const;
}

function Fields({
  driver,
  employees,
  vehicles,
}: {
  driver?: DriverRow;
  employees: EmployeeOpt[];
  vehicles: VehicleOpt[];
}) {
  const t = useTranslations("drivers");
  const tc = useTranslations("common");
  return (
    <>
      <FormField label={t("employee")} htmlFor="employeeId">
        <Select id="employeeId" name="employeeId" defaultValue={driver?.employeeId ?? ""} required>
          <option value="" disabled>
            —
          </option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.jobTitle ? `${e.label} — ${e.jobTitle}` : e.label}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("licenceNo")} htmlFor="licenceNo">
          <Input id="licenceNo" name="licenceNo" dir="ltr" defaultValue={driver?.licenceNo ?? ""} />
        </FormField>
        <FormField label={t("licenceExpiry")} htmlFor="licenceExpiry">
          <Input
            id="licenceExpiry"
            name="licenceExpiry"
            type="date"
            dir="ltr"
            defaultValue={driver?.licenceExpiry ?? ""}
          />
        </FormField>
      </div>
      <FormField label={t("defaultVehicle")} htmlFor="defaultVehicleId">
        <Select
          id="defaultVehicleId"
          name="defaultVehicleId"
          defaultValue={driver?.defaultVehicleId ?? ""}
        >
          <option value="">—</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plate}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("shiftStart")} htmlFor="shiftStartMin">
          <Input
            id="shiftStartMin"
            name="shiftStartMin"
            type="time"
            dir="ltr"
            defaultValue={driver?.shiftStartMin != null ? minToHHMM(driver.shiftStartMin) : ""}
          />
        </FormField>
        <FormField label={t("shiftEnd")} htmlFor="shiftEndMin">
          <Input
            id="shiftEndMin"
            name="shiftEndMin"
            type="time"
            dir="ltr"
            defaultValue={driver?.shiftEndMin != null ? minToHHMM(driver.shiftEndMin) : ""}
          />
        </FormField>
      </div>
      <p className="text-xs text-muted-foreground">{t("shiftHint")}</p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={driver?.active ?? true}
          className="size-4 accent-primary"
        />
        {tc("active")}
      </label>
      <FormField label={tc("notes")} htmlFor="notes">
        <Input id="notes" name="notes" defaultValue={driver?.notes ?? ""} />
      </FormField>
    </>
  );
}

export function DriversClient({
  drivers,
  employees,
  vehicles,
  windowDays,
}: {
  drivers: DriverRow[];
  employees: EmployeeOpt[];
  vehicles: VehicleOpt[];
  windowDays: number;
}) {
  const t = useTranslations("drivers");
  const tc = useTranslations("common");
  const locale = useLocale();

  // An expired licence blocks dispatch outright, so it leads the alert.
  const alerts = useMemo(
    () =>
      drivers
        .filter((d) => d.active && (d.licenceLevel === "expired" || d.licenceLevel === "soon"))
        .sort((a, b) => (a.licenceExpiry ?? "").localeCompare(b.licenceExpiry ?? "")),
    [drivers],
  );

  const search = useTableSearch(drivers, (d) => [d.name, d.licenceNo, d.defaultVehiclePlate, d.phone]);
  const columns = useMemo<ColumnDef<DriverRow>[]>(
    () => [
      { key: "name", label: tc("name"), value: (d) => d.name },
      { key: "phone", label: tc("phone"), value: (d) => d.phone },
      { key: "licence", label: t("licence"), value: (d) => d.licenceNo },
      { key: "licenceExpiry", label: t("licenceExpiry"), type: "date", value: (d) => d.licenceExpiry },
      { key: "vehicle", label: t("defaultVehicle"), value: (d) => d.defaultVehiclePlate, filterable: true },
      { key: "shift", label: t("shift") },
      {
        key: "status",
        label: tc("status"),
        type: "enum",
        value: (d) => (d.active ? "active" : "inactive"),
        filterable: true,
        options: ["active", "inactive"],
        optionLabel: (x) => tc(x as "active"),
      },
      { key: "actions", label: tc("actions") },
    ],
    [t, tc],
  );
  const sf = useTableSortFilter(search.filtered, columns);
  const pg = usePagination(sf.rows, 20, sf.version);

  return (
    <>
      {alerts.length > 0 && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium">
            <TriangleAlert className="size-4" />
            {t("licenceAlert", { days: windowDays, count: alerts.length })}
          </p>
          <ul className="flex flex-wrap gap-2">
            {alerts.map((d) => (
              <li key={d.id}>
                <Badge variant={levelVariant(d.licenceLevel)} className="gap-1">
                  <span>{d.name}</span>
                  {d.licenceExpiry && <span dir="ltr">· {d.licenceExpiry}</span>}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <TableSearch
          value={search.query}
          onChange={search.setQuery}
          resultCount={search.filtered.length}
          placeholder={t("searchPlaceholder")}
        />
        <EntityDialog
          title={t("add")}
          action={saveDriver.bind(null, locale, null)}
          fields={<Fields employees={employees} vehicles={vehicles} />}
          trigger={
            <Button className="gap-2">
              <Plus className="size-4" />
              {t("add")}
            </Button>
          }
        />
      </div>

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
            {pg.pageItems.map((d) => (
              <TableRow key={d.id} className={d.active ? undefined : "opacity-60"}>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell>
                  <span dir="ltr">{d.phone ?? "—"}</span>
                </TableCell>
                <TableCell>
                  <span dir="ltr">{d.licenceNo ?? "—"}</span>
                </TableCell>
                <TableCell>
                  {d.licenceExpiry ? (
                    <Badge variant={levelVariant(d.licenceLevel)}>
                      <span dir="ltr">{d.licenceExpiry}</span>
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span dir="ltr">{d.defaultVehiclePlate ?? "—"}</span>
                </TableCell>
                <TableCell className="tabular-nums">
                  {d.shiftStartMin != null && d.shiftEndMin != null ? (
                    <span dir="ltr">
                      {minToHHMM(d.shiftStartMin)}–{minToHHMM(d.shiftEndMin)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t("noShift")}</span>
                  )}
                </TableCell>
                <TableCell>
                  {d.active ? (
                    <Badge variant="success">{tc("active")}</Badge>
                  ) : (
                    <Badge variant="muted">{tc("inactive")}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <RowActions>
                    <ViewDialog
                      title={d.name}
                      subtitle={d.jobTitle}
                      fields={[
                        { label: tc("name"), value: d.name },
                        { label: tc("phone"), value: d.phone, ltr: true },
                        { label: t("licenceNo"), value: d.licenceNo, ltr: true },
                        {
                          label: t("licenceExpiry"),
                          value: d.licenceExpiry ? (
                            <Badge variant={levelVariant(d.licenceLevel)}>
                              <span dir="ltr">{d.licenceExpiry}</span>
                            </Badge>
                          ) : null,
                        },
                        { label: t("defaultVehicle"), value: d.defaultVehiclePlate, ltr: true },
                        {
                          label: t("shift"),
                          value:
                            d.shiftStartMin != null && d.shiftEndMin != null
                              ? `${minToHHMM(d.shiftStartMin)}–${minToHHMM(d.shiftEndMin)}`
                              : t("noShift"),
                          ltr: d.shiftStartMin != null,
                        },
                        {
                          label: tc("status"),
                          value: (
                            <Badge variant={d.active ? "success" : "muted"}>
                              {d.active ? tc("active") : tc("inactive")}
                            </Badge>
                          ),
                        },
                        { label: tc("notes"), value: d.notes, wide: true },
                      ]}
                    />
                    <EntityDialog
                      title={t("edit")}
                      action={saveDriver.bind(null, locale, d.id)}
                      fields={<Fields driver={d} employees={employees} vehicles={vehicles} />}
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    <DeleteButton action={deleteDriver.bind(null, locale, d.id)} />
                  </RowActions>
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
