"use client";

import { useTranslations } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/money";

export type DriverStat = {
  driverId: string;
  name: string;
  trips: number;
  busyMin: number;
  km: number;
  utilisation: number | null;
};

export type VehicleStat = {
  id: string;
  plate: string;
  odometerKm: number;
  trips: number;
  km: number;
  fuelCost: number;
  maintCost: number;
  litres: number;
  kmPerLitre: number | null;
  costPerKm: number | null;
};

export type Totals = {
  trips: number;
  km: number;
  fuelCost: number;
  maintCost: number;
  totalCost: number;
  costPerKm: number | null;
  costPerTrip: number | null;
  onTimeRate: number | null;
  onTimeMeasured: number;
};

/** A dash, not a zero: the difference between "none" and "not measurable". */
const dash = "—";
const pct = (v: number | null) => (v == null ? dash : `${Math.round(v * 100)}%`);

export function ReportsClient({
  filters,
  totals,
  drivers,
  vehicles,
}: {
  filters: { from: string; to: string };
  totals: Totals;
  drivers: DriverStat[];
  vehicles: VehicleStat[];
}) {
  const t = useTranslations("transportReports");
  const tc = useTranslations("common");
  const router = useRouter();
  const pathname = usePathname();

  function apply(form: HTMLFormElement) {
    const fd = new FormData(form);
    const params = new URLSearchParams();
    for (const k of ["from", "to"]) {
      const v = String(fd.get(k) ?? "");
      if (v) params.set(k, v);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  const cards: { label: string; value: string }[] = [
    { label: t("trips"), value: String(totals.trips) },
    { label: t("km"), value: totals.km.toFixed(1) },
    { label: t("fuelCost"), value: formatMoney(totals.fuelCost) },
    { label: t("maintCost"), value: formatMoney(totals.maintCost) },
    { label: t("totalCost"), value: formatMoney(totals.totalCost) },
    { label: t("costPerKm"), value: totals.costPerKm == null ? dash : formatMoney(totals.costPerKm) },
    { label: t("costPerTrip"), value: totals.costPerTrip == null ? dash : formatMoney(totals.costPerTrip) },
    { label: t("onTime"), value: pct(totals.onTimeRate) },
  ];

  return (
    <>
      <form
        className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault();
          apply(e.currentTarget);
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
        <Button type="submit" variant="secondary">
          {tc("filter")}
        </Button>
      </form>

      <div className="mb-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className="text-xl font-semibold tabular-nums" dir="ltr">
              {c.value}
            </p>
          </div>
        ))}
      </div>

      {/* The distance behind every cost-per-km figure is the planner's
          estimate, so the whole panel is an estimate. Say so once, here. */}
      <p className="mb-5 text-xs text-muted-foreground">
        {t("estimateNote")}
        {totals.onTimeMeasured > 0 && ` ${t("onTimeBasis", { count: totals.onTimeMeasured })}`}
      </p>

      <h2 className="mb-2 text-lg font-semibold">{t("byDriver")}</h2>
      <div className="mb-6 rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tc("name")}</TableHead>
              <TableHead className="text-end">{t("trips")}</TableHead>
              <TableHead className="text-end">{t("hours")}</TableHead>
              <TableHead className="text-end">{t("km")}</TableHead>
              <TableHead className="text-end">{t("utilisation")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {drivers.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {drivers.map((d) => (
              <TableRow key={d.driverId}>
                <TableCell className="font-medium">{d.name}</TableCell>
                <TableCell className="text-end tabular-nums">{d.trips}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {(d.busyMin / 60).toFixed(1)}
                </TableCell>
                <TableCell className="text-end tabular-nums">{d.km.toFixed(1)}</TableCell>
                <TableCell className="text-end">
                  {d.utilisation == null ? (
                    <span className="text-muted-foreground">{dash}</span>
                  ) : (
                    <Badge
                      variant={
                        d.utilisation >= 0.75 ? "success" : d.utilisation >= 0.4 ? "warning" : "muted"
                      }
                    >
                      {pct(d.utilisation)}
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <h2 className="mb-2 text-lg font-semibold">{t("byVehicle")}</h2>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("vehicle")}</TableHead>
              <TableHead className="text-end">{t("odometerKm")}</TableHead>
              <TableHead className="text-end">{t("trips")}</TableHead>
              <TableHead className="text-end">{t("km")}</TableHead>
              <TableHead className="text-end">{t("litres")}</TableHead>
              <TableHead className="text-end">{t("kmPerLitre")}</TableHead>
              <TableHead className="text-end">{t("fuelCost")}</TableHead>
              <TableHead className="text-end">{t("maintCost")}</TableHead>
              <TableHead className="text-end">{t("costPerKm")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {vehicles.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {vehicles.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-medium">
                  <span dir="ltr">{v.plate}</span>
                </TableCell>
                <TableCell className="text-end tabular-nums">{v.odometerKm}</TableCell>
                <TableCell className="text-end tabular-nums">{v.trips}</TableCell>
                <TableCell className="text-end tabular-nums">{v.km.toFixed(1)}</TableCell>
                <TableCell className="text-end tabular-nums">{v.litres.toFixed(1)}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {v.kmPerLitre == null ? (
                    <span className="text-muted-foreground">{dash}</span>
                  ) : (
                    v.kmPerLitre.toFixed(2)
                  )}
                </TableCell>
                <TableCell className="text-end tabular-nums">{formatMoney(v.fuelCost)}</TableCell>
                <TableCell className="text-end tabular-nums">{formatMoney(v.maintCost)}</TableCell>
                <TableCell className="text-end tabular-nums">
                  {v.costPerKm == null ? (
                    <span className="text-muted-foreground">{dash}</span>
                  ) : (
                    formatMoney(v.costPerKm)
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
