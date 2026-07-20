"use client";

import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil } from "lucide-react";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePagination, TablePagination } from "@/components/ui/table-pagination";
import { formatMoney, formatHours } from "@/lib/money";
import { savePackage, deletePackage } from "./actions";

export type Opt = { id: string; label: string };
export type PackageRow = {
  id: string;
  studentId: string;
  studentName: string;
  totalHours: number;
  hoursUsed: number;
  price: number;
  purchasedAt: string;
  expiresAt: string | null;
  status: string;
  notes: string | null;
};

function statusVariant(s: string) {
  if (s === "ACTIVE") return "success" as const;
  if (s === "COMPLETED") return "muted" as const;
  return "destructive" as const;
}

function Fields({ pkg, students }: { pkg?: PackageRow; students: Opt[] }) {
  const t = useTranslations("packages");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <FormField label={tc("name")} htmlFor="studentId">
        <Select id="studentId" name="studentId" defaultValue={pkg?.studentId ?? ""} required>
          <option value="">—</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </Select>
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("totalHours")} htmlFor="totalHours">
          <Input id="totalHours" name="totalHours" type="number" step="0.5" min="0" dir="ltr" defaultValue={pkg?.totalHours ?? ""} required />
        </FormField>
        <FormField label={t("hoursUsed")} htmlFor="hoursUsed">
          <Input id="hoursUsed" name="hoursUsed" type="number" step="0.5" min="0" dir="ltr" defaultValue={pkg?.hoursUsed ?? 0} />
        </FormField>
      </div>
      <FormField label={t("price")} htmlFor="price">
        <Input id="price" name="price" type="number" step="5" min="0" dir="ltr" defaultValue={pkg?.price ?? ""} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("purchasedAt")} htmlFor="purchasedAt">
          <Input id="purchasedAt" name="purchasedAt" type="date" dir="ltr" defaultValue={pkg?.purchasedAt ?? today} required />
        </FormField>
        <FormField label={t("expiresAt")} htmlFor="expiresAt">
          <Input id="expiresAt" name="expiresAt" type="date" dir="ltr" defaultValue={pkg?.expiresAt ?? ""} />
        </FormField>
      </div>
      <FormField label={tc("status")} htmlFor="status">
        <Select id="status" name="status" defaultValue={pkg?.status ?? "ACTIVE"}>
          <option value="ACTIVE">{te("packageStatus.ACTIVE")}</option>
          <option value="COMPLETED">{te("packageStatus.COMPLETED")}</option>
          <option value="EXPIRED">{te("packageStatus.EXPIRED")}</option>
        </Select>
      </FormField>
    </>
  );
}

export function PackagesClient({
  packages,
  students,
  currency,
}: {
  packages: PackageRow[];
  students: Opt[];
  currency: string;
}) {
  const t = useTranslations("packages");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const pg = usePagination(packages);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <EntityDialog
          title={t("add")}
          action={savePackage.bind(null, locale, null)}
          fields={<Fields students={students} />}
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
            <TableRow>
              <TableHead>{tc("name")}</TableHead>
              <TableHead className="text-end">{t("totalHours")}</TableHead>
              <TableHead className="text-end">{t("hoursUsed")}</TableHead>
              <TableHead className="text-end">{t("hoursRemaining")}</TableHead>
              <TableHead className="text-end">{t("price")}</TableHead>
              <TableHead>{tc("status")}</TableHead>
              <TableHead className="text-end">{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {packages.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.studentName}</TableCell>
                <TableCell className="text-end tabular-nums">{formatHours(p.totalHours)}</TableCell>
                <TableCell className="text-end tabular-nums">{formatHours(p.hoursUsed)}</TableCell>
                <TableCell className="text-end tabular-nums font-medium">{formatHours(p.totalHours - p.hoursUsed)}</TableCell>
                <TableCell className="text-end tabular-nums">{formatMoney(p.price)} {currency}</TableCell>
                <TableCell><Badge variant={statusVariant(p.status)}>{te(`packageStatus.${p.status}`)}</Badge></TableCell>
                <TableCell className="text-end">
                  <div className="flex justify-end gap-1">
                    <EntityDialog
                      title={t("edit")}
                      action={savePackage.bind(null, locale, p.id)}
                      fields={<Fields pkg={p} students={students} />}
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    <DeleteButton action={deletePackage.bind(null, locale, p.id)} />
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
