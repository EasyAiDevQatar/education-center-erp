"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, FileText, Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { DeleteButton } from "@/components/crud/delete-button";
import { FormField } from "@/components/crud/form-field";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { VEHICLE_DOC_TYPES } from "@/lib/enums";
import type { ExpiryLevel } from "@/lib/transport/fleet";
import {
  saveVehicle,
  deleteVehicle,
  saveVehicleDocument,
  deleteVehicleDocument,
} from "./actions";

export type VehicleDocRow = {
  id: string;
  type: string;
  number: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  level: ExpiryLevel;
};

export type VehicleRow = {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  year: number | null;
  capacity: number;
  odometerKm: number;
  active: boolean;
  notes: string | null;
  driverCount: number;
  documents: VehicleDocRow[];
};

export type VehicleAlert = {
  vehicleId: string;
  plate: string;
  type: string;
  expiresOn: string | null;
  level: ExpiryLevel;
};

/** Badge colour for an expiry bucket. `unknown` is amber, never green. */
function levelVariant(level: ExpiryLevel) {
  if (level === "expired") return "destructive" as const;
  if (level === "soon") return "warning" as const;
  if (level === "unknown") return "muted" as const;
  return "success" as const;
}

function Fields({ vehicle }: { vehicle?: VehicleRow }) {
  const t = useTranslations("vehicles");
  const tc = useTranslations("common");
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("plate")} htmlFor="plate">
          <Input id="plate" name="plate" dir="ltr" defaultValue={vehicle?.plate} required />
        </FormField>
        <FormField label={t("year")} htmlFor="year">
          <Input
            id="year"
            name="year"
            type="number"
            dir="ltr"
            min={1950}
            max={2100}
            defaultValue={vehicle?.year ?? ""}
          />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("make")} htmlFor="make">
          <Input id="make" name="make" defaultValue={vehicle?.make ?? ""} />
        </FormField>
        <FormField label={t("model")} htmlFor="model">
          <Input id="model" name="model" defaultValue={vehicle?.model ?? ""} />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("capacity")} htmlFor="capacity">
          <Input
            id="capacity"
            name="capacity"
            type="number"
            dir="ltr"
            min={1}
            max={60}
            defaultValue={vehicle?.capacity ?? 4}
          />
        </FormField>
        <FormField label={t("odometerKm")} htmlFor="odometerKm">
          <Input
            id="odometerKm"
            name="odometerKm"
            type="number"
            dir="ltr"
            min={0}
            defaultValue={vehicle?.odometerKm ?? 0}
          />
        </FormField>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={vehicle?.active ?? true}
          className="size-4 accent-primary"
        />
        {tc("active")}
      </label>
      <FormField label={tc("notes")} htmlFor="notes">
        <Input id="notes" name="notes" defaultValue={vehicle?.notes ?? ""} />
      </FormField>
    </>
  );
}

/** Papers for one vehicle. A renewal is a NEW row, never an edit. */
function DocumentsDialog({
  vehicle,
  onClose,
}: {
  vehicle: VehicleRow;
  onClose: () => void;
}) {
  const t = useTranslations("vehicles");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    start(async () => {
      const res = await saveVehicleDocument(locale, {}, fd);
      if (res.ok) {
        form.reset();
        router.refresh();
      } else setError(res.error ?? "invalid");
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("documentsFor", { plate: vehicle.plate })}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {vehicle.documents.length === 0 ? (
            <p className="py-3 text-center text-sm text-muted-foreground">{tc("noData")}</p>
          ) : (
            <div className="space-y-1">
              {vehicle.documents.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                >
                  <span className="font-medium">{te(`vehicleDocType.${d.type}`)}</span>
                  {d.number && (
                    <span className="text-muted-foreground tabular-nums" dir="ltr">
                      {d.number}
                    </span>
                  )}
                  <span className="ms-auto flex shrink-0 items-center gap-2">
                    {d.expiresOn && (
                      <Badge variant={levelVariant(d.level)}>
                        <span dir="ltr">{d.expiresOn}</span>
                      </Badge>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={tc("delete")}
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          await deleteVehicleDocument(locale, d.id);
                          router.refresh();
                        })
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={onSubmit} className="space-y-3 rounded-md border border-border p-3">
            <input type="hidden" name="vehicleId" value={vehicle.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t("docType")} htmlFor="v-type">
                <Select id="v-type" name="type" defaultValue="REGISTRATION">
                  {VEHICLE_DOC_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {te(`vehicleDocType.${x}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t("docNumber")} htmlFor="v-number">
                <Input id="v-number" name="number" dir="ltr" />
              </FormField>
              <FormField label={t("issuedOn")} htmlFor="v-issued">
                <Input id="v-issued" name="issuedOn" type="date" dir="ltr" />
              </FormField>
              <FormField label={t("expiresOn")} htmlFor="v-expires">
                <Input id="v-expires" name="expiresOn" type="date" dir="ltr" />
              </FormField>
            </div>
            {error && <p className="text-sm text-destructive">{tc("required")}</p>}
            <Button type="submit" size="sm" disabled={pending} className="gap-1">
              <Plus className="size-4" />
              {t("addDocument")}
            </Button>
          </form>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {tc("close")}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function VehiclesClient({
  vehicles,
  alerts,
  windowDays,
}: {
  vehicles: VehicleRow[];
  alerts: VehicleAlert[];
  windowDays: number;
}) {
  const t = useTranslations("vehicles");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const [docsFor, setDocsFor] = useState<VehicleRow | null>(null);

  const search = useTableSearch(vehicles, (v) => [v.plate, v.make, v.model, v.notes]);
  const columns = useMemo<ColumnDef<VehicleRow>[]>(
    () => [
      { key: "plate", label: t("plate"), value: (v) => v.plate },
      { key: "vehicle", label: t("makeModel"), value: (v) => [v.make, v.model].filter(Boolean).join(" ") },
      { key: "year", label: t("year"), type: "number", value: (v) => v.year, className: "text-end" },
      { key: "capacity", label: t("capacity"), type: "number", value: (v) => v.capacity, className: "text-end" },
      { key: "odometerKm", label: t("odometerKm"), type: "number", value: (v) => v.odometerKm, className: "text-end" },
      { key: "papers", label: t("papers") },
      {
        key: "status",
        label: tc("status"),
        type: "enum",
        value: (v) => (v.active ? "active" : "inactive"),
        filterable: true,
        options: ["active", "inactive"],
        optionLabel: (x) => tc(x as "active"),
      },
      { key: "actions", label: tc("actions"), className: "text-end" },
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
            {t("expiryAlert", { days: windowDays, count: alerts.length })}
          </p>
          <ul className="flex flex-wrap gap-2">
            {alerts.map((a) => (
              <li key={`${a.vehicleId}-${a.type}`}>
                <Badge variant={levelVariant(a.level)} className="gap-1">
                  <span dir="ltr">{a.plate}</span>
                  <span>· {te(`vehicleDocType.${a.type}`)}</span>
                  {a.expiresOn && <span dir="ltr">· {a.expiresOn}</span>}
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
          action={saveVehicle.bind(null, locale, null)}
          fields={<Fields />}
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
            {pg.pageItems.map((v) => {
              const worst = v.documents.some((d) => d.level === "expired")
                ? "expired"
                : v.documents.some((d) => d.level === "soon")
                  ? "soon"
                  : null;
              return (
                <TableRow key={v.id} className={v.active ? undefined : "opacity-60"}>
                  <TableCell className="font-medium">
                    <span dir="ltr">{v.plate}</span>
                  </TableCell>
                  <TableCell>{[v.make, v.model].filter(Boolean).join(" ") || "—"}</TableCell>
                  <TableCell className="text-end tabular-nums">{v.year ?? "—"}</TableCell>
                  <TableCell className="text-end tabular-nums">{v.capacity}</TableCell>
                  <TableCell className="text-end tabular-nums">{v.odometerKm}</TableCell>
                  <TableCell>
                    {v.documents.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Badge variant={worst ? levelVariant(worst) : "success"}>
                        {v.documents.length}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {v.active ? (
                      <Badge variant="success">{tc("active")}</Badge>
                    ) : (
                      <Badge variant="muted">{tc("inactive")}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("documents")}
                        onClick={() => setDocsFor(v)}
                      >
                        <FileText className="size-4" />
                      </Button>
                      <EntityDialog
                        title={t("edit")}
                        action={saveVehicle.bind(null, locale, v.id)}
                        fields={<Fields vehicle={v} />}
                        trigger={
                          <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                            <Pencil className="size-4" />
                          </Button>
                        }
                      />
                      {v.driverCount === 0 && (
                        <DeleteButton action={deleteVehicle.bind(null, locale, v.id)} />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <TablePagination {...pg} />
      </div>

      {docsFor && (
        <DocumentsDialog
          vehicle={vehicles.find((x) => x.id === docsFor.id) ?? docsFor}
          onClose={() => setDocsFor(null)}
        />
      )}
    </>
  );
}
