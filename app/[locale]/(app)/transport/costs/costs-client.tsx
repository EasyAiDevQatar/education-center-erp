"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Fuel, Wrench } from "lucide-react";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { DeleteButton } from "@/components/crud/delete-button";
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
import { formatMoney } from "@/lib/money";
import { MAINTENANCE_KINDS } from "@/lib/enums";
import {
  saveFuelLog,
  deleteFuelLog,
  saveMaintenanceLog,
  deleteMaintenanceLog,
} from "./actions";

export type Opt = { id: string; label: string };

export type FuelRow = {
  id: string;
  date: string;
  plate: string;
  litres: number;
  cost: number;
  odometerKm: number | null;
  supplierName: string | null;
  expenseStatus: string | null;
  notes: string | null;
};

export type MaintRow = {
  id: string;
  date: string;
  plate: string;
  kind: string;
  description: string;
  cost: number;
  odometerKm: number | null;
  supplierName: string | null;
  expenseStatus: string | null;
  nextDueKm: number | null;
  nextDueOn: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);

function VehicleSupplierFields({
  vehicles,
  suppliers,
}: {
  vehicles: Opt[];
  suppliers: Opt[];
}) {
  const t = useTranslations("transportCosts");
  const tc = useTranslations("common");
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("vehicle")} htmlFor="vehicleId">
          <Select id="vehicleId" name="vehicleId" required>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={tc("date")} htmlFor="date">
          <Input id="date" name="date" type="date" dir="ltr" defaultValue={today()} />
        </FormField>
      </div>
      <FormField label={t("supplier")} htmlFor="supplierId">
        <Select id="supplierId" name="supplierId" defaultValue="">
          <option value="">—</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </FormField>
    </>
  );
}

function FuelFields({ vehicles, suppliers }: { vehicles: Opt[]; suppliers: Opt[] }) {
  const t = useTranslations("transportCosts");
  const tc = useTranslations("common");
  return (
    <>
      <VehicleSupplierFields vehicles={vehicles} suppliers={suppliers} />
      <div className="grid grid-cols-3 gap-3">
        <FormField label={t("litres")} htmlFor="litres">
          <Input id="litres" name="litres" type="number" step="0.01" dir="ltr" required />
        </FormField>
        <FormField label={t("cost")} htmlFor="cost">
          <Input id="cost" name="cost" type="number" step="0.01" dir="ltr" required />
        </FormField>
        <FormField label={t("odometerKm")} htmlFor="odometerKm">
          <Input id="odometerKm" name="odometerKm" type="number" dir="ltr" />
        </FormField>
      </div>
      <p className="text-xs text-muted-foreground">{t("odometerHint")}</p>
      <FormField label={tc("notes")} htmlFor="notes">
        <Input id="notes" name="notes" />
      </FormField>
    </>
  );
}

function MaintFields({ vehicles, suppliers }: { vehicles: Opt[]; suppliers: Opt[] }) {
  const t = useTranslations("transportCosts");
  const te = useTranslations("enums");
  return (
    <>
      <VehicleSupplierFields vehicles={vehicles} suppliers={suppliers} />
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("kind")} htmlFor="kind">
          <Select id="kind" name="kind" defaultValue="SERVICE">
            {MAINTENANCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {te(`maintenanceKind.${k}`)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("cost")} htmlFor="cost">
          <Input id="cost" name="cost" type="number" step="0.01" dir="ltr" required />
        </FormField>
      </div>
      <FormField label={t("description")} htmlFor="description">
        <Input id="description" name="description" required />
      </FormField>
      <div className="grid grid-cols-3 gap-3">
        <FormField label={t("odometerKm")} htmlFor="odometerKm">
          <Input id="odometerKm" name="odometerKm" type="number" dir="ltr" />
        </FormField>
        <FormField label={t("nextDueKm")} htmlFor="nextDueKm">
          <Input id="nextDueKm" name="nextDueKm" type="number" dir="ltr" />
        </FormField>
        <FormField label={t("nextDueOn")} htmlFor="nextDueOn">
          <Input id="nextDueOn" name="nextDueOn" type="date" dir="ltr" />
        </FormField>
      </div>
    </>
  );
}

export function CostsClient({
  fuel,
  maintenance,
  vehicles,
  suppliers,
  currency,
}: {
  fuel: FuelRow[];
  maintenance: MaintRow[];
  vehicles: Opt[];
  suppliers: Opt[];
  currency: string;
}) {
  const t = useTranslations("transportCosts");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const [tab, setTab] = useState<"fuel" | "maintenance">("fuel");

  const fuelCols = useMemo<ColumnDef<FuelRow>[]>(
    () => [
      { key: "date", label: tc("date"), type: "date", value: (x) => x.date },
      { key: "plate", label: t("vehicle"), value: (x) => x.plate, filterable: true },
      { key: "litres", label: t("litres"), type: "number", value: (x) => x.litres, className: "text-end" },
      { key: "cost", label: t("cost"), type: "number", value: (x) => x.cost, className: "text-end" },
      { key: "odo", label: t("odometerKm"), type: "number", value: (x) => x.odometerKm, className: "text-end" },
      { key: "supplier", label: t("supplier"), value: (x) => x.supplierName, filterable: true },
      { key: "expense", label: t("expense") },
      { key: "actions", label: tc("actions"), className: "text-end" },
    ],
    [t, tc],
  );
  const maintCols = useMemo<ColumnDef<MaintRow>[]>(
    () => [
      { key: "date", label: tc("date"), type: "date", value: (x) => x.date },
      { key: "plate", label: t("vehicle"), value: (x) => x.plate, filterable: true },
      {
        key: "kind",
        label: t("kind"),
        type: "enum",
        value: (x) => x.kind,
        filterable: true,
        options: [...MAINTENANCE_KINDS],
        optionLabel: (v) => te(`maintenanceKind.${v}`),
      },
      { key: "description", label: t("description"), value: (x) => x.description },
      { key: "cost", label: t("cost"), type: "number", value: (x) => x.cost, className: "text-end" },
      { key: "next", label: t("nextDue") },
      { key: "expense", label: t("expense") },
      { key: "actions", label: tc("actions"), className: "text-end" },
    ],
    [t, tc, te],
  );

  const fuelSf = useTableSortFilter(fuel, fuelCols);
  const fuelPg = usePagination(fuelSf.rows, 20, fuelSf.version);
  const maintSf = useTableSortFilter(maintenance, maintCols);
  const maintPg = usePagination(maintSf.rows, 20, maintSf.version);

  const expenseBadge = (status: string | null) =>
    status === null ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <Badge variant={status === "POSTED" ? "success" : status === "DRAFT" ? "warning" : "default"}>
        {te(`expenseStatus.${status}`)}
      </Badge>
    );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
          <Button
            type="button"
            size="sm"
            variant={tab === "fuel" ? "default" : "ghost"}
            className="gap-1"
            onClick={() => setTab("fuel")}
          >
            <Fuel className="size-4" />
            {t("fuel")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tab === "maintenance" ? "default" : "ghost"}
            className="gap-1"
            onClick={() => setTab("maintenance")}
          >
            <Wrench className="size-4" />
            {t("maintenance")}
          </Button>
        </div>

        <div className="ms-auto">
          {tab === "fuel" ? (
            <EntityDialog
              title={t("addFuel")}
              action={saveFuelLog.bind(null, locale)}
              fields={<FuelFields vehicles={vehicles} suppliers={suppliers} />}
              trigger={
                <Button className="gap-2" disabled={vehicles.length === 0}>
                  <Plus className="size-4" />
                  {t("addFuel")}
                </Button>
              }
            />
          ) : (
            <EntityDialog
              title={t("addMaintenance")}
              action={saveMaintenanceLog.bind(null, locale)}
              fields={<MaintFields vehicles={vehicles} suppliers={suppliers} />}
              trigger={
                <Button className="gap-2" disabled={vehicles.length === 0}>
                  <Plus className="size-4" />
                  {t("addMaintenance")}
                </Button>
              }
            />
          )}
        </div>
      </div>

      {vehicles.length === 0 && (
        <p className="mb-4 rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
          {t("noVehicles")}
        </p>
      )}

      <p className="mb-3 text-xs text-muted-foreground">{t("postsToExpenses")}</p>

      {tab === "fuel" ? (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <SortableTableHeader sf={fuelSf} />
            </TableHeader>
            <TableBody>
              {fuelPg.total === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    {tc("noData")}
                  </TableCell>
                </TableRow>
              )}
              {fuelPg.pageItems.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="tabular-nums">
                    <span dir="ltr">{x.date}</span>
                  </TableCell>
                  <TableCell>
                    <span dir="ltr">{x.plate}</span>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{x.litres.toFixed(2)}</TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {formatMoney(x.cost)} {currency}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{x.odometerKm ?? "—"}</TableCell>
                  <TableCell>{x.supplierName ?? "—"}</TableCell>
                  <TableCell>{expenseBadge(x.expenseStatus)}</TableCell>
                  <TableCell className="text-end">
                    <DeleteButton action={deleteFuelLog.bind(null, locale, x.id)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination {...fuelPg} />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <SortableTableHeader sf={maintSf} />
            </TableHeader>
            <TableBody>
              {maintPg.total === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    {tc("noData")}
                  </TableCell>
                </TableRow>
              )}
              {maintPg.pageItems.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="tabular-nums">
                    <span dir="ltr">{x.date}</span>
                  </TableCell>
                  <TableCell>
                    <span dir="ltr">{x.plate}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="default">{te(`maintenanceKind.${x.kind}`)}</Badge>
                  </TableCell>
                  <TableCell>{x.description}</TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {formatMoney(x.cost)} {currency}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {x.nextDueOn && <span dir="ltr">{x.nextDueOn}</span>}
                    {x.nextDueKm != null && (
                      <span dir="ltr">{x.nextDueOn ? " · " : ""}{x.nextDueKm} km</span>
                    )}
                    {!x.nextDueOn && x.nextDueKm == null && "—"}
                  </TableCell>
                  <TableCell>{expenseBadge(x.expenseStatus)}</TableCell>
                  <TableCell className="text-end">
                    <DeleteButton action={deleteMaintenanceLog.bind(null, locale, x.id)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination {...maintPg} />
        </div>
      )}
    </>
  );
}
