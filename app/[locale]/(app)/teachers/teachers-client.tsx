"use client";

import { useMemo, useState } from "react";

import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, CircleUserRound, Map } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { DeleteButton } from "@/components/crud/delete-button";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import { MapPicker } from "@/components/map-picker";
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
import { saveTeacher, deleteTeacher } from "./actions";
import { displayName, nameSearchText } from "@/lib/names";
import { EARNINGS_MODES } from "@/lib/earnings-mode";

export type TeacherRow = {
  id: string;
  name: string;
  nameEn: string | null;
  phone: string | null;
  commissionPct: number;
  fixedSalary: number;
  fixedDeductions: number;
  /** null = inherit the centre default payment mode. */
  paymentMode: string | null;
  /** null = inherit the centre default earnings mode. */
  earningsMode: string | null;
  active: boolean;
  notes: string | null;
  address: string | null;
  homeLat: number | null;
  homeLng: number | null;
  /** Subject ids the teacher teaches (for the edit form). */
  subjectIds: string[];
  /** Localised subject names, for the table badges. */
  subjectLabels: string[];
};

export type SubjectOpt = { id: string; label: string };

function TeacherFields({ teacher, subjects }: { teacher?: TeacherRow; subjects: SubjectOpt[] }) {
  const t = useTranslations("teachers");
  const tc = useTranslations("common");
  const tm = useTranslations("paymentModes");
  const tem = useTranslations("earningsModes");
  const [address, setAddress] = useState(teacher?.address ?? "");
  const [lat, setLat] = useState(teacher?.homeLat != null ? String(teacher.homeLat) : "");
  const [lng, setLng] = useState(teacher?.homeLng != null ? String(teacher.homeLng) : "");
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={tc("nameAr")} htmlFor="name">
          <Input id="name" name="name" defaultValue={teacher?.name} required />
        </FormField>
        <FormField label={tc("nameEn")} htmlFor="nameEn" hint={tc("nameEnHint")}>
          <Input id="nameEn" name="nameEn" dir="ltr" defaultValue={teacher?.nameEn ?? ""} />
        </FormField>
      </div>
      <FormField label={tc("phone")} htmlFor="phone">
        <Input id="phone" name="phone" dir="ltr" defaultValue={teacher?.phone ?? ""} />
      </FormField>
      <SubjectsPicker subjects={subjects} initial={teacher?.subjectIds ?? []} />
      <FormField label={t("commissionPct")} htmlFor="commissionPct">
        <Input
          id="commissionPct"
          name="commissionPct"
          type="number"
          step="0.5"
          min="0"
          max="100"
          dir="ltr"
          defaultValue={teacher?.commissionPct ?? 0}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("fixedSalary")} htmlFor="fixedSalary">
          <Input
            id="fixedSalary"
            name="fixedSalary"
            type="number"
            step="0.01"
            min="0"
            dir="ltr"
            defaultValue={teacher?.fixedSalary ?? 0}
          />
        </FormField>
        <FormField label={t("fixedDeductions")} htmlFor="fixedDeductions">
          <Input
            id="fixedDeductions"
            name="fixedDeductions"
            type="number"
            step="0.01"
            min="0"
            dir="ltr"
            defaultValue={teacher?.fixedDeductions ?? 0}
          />
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("earningsMode")} htmlFor="earningsMode" hint={t("earningsModeHint")}>
          <Select id="earningsMode" name="earningsMode" defaultValue={teacher?.earningsMode ?? ""}>
            <option value="">{t("earningsModeDefault")}</option>
            {EARNINGS_MODES.map((m) => (
              <option key={m} value={m}>
                {tem(m)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("paymentMode")} htmlFor="paymentMode" hint={t("paymentModeHint")}>
          <Select id="paymentMode" name="paymentMode" defaultValue={teacher?.paymentMode ?? ""}>
            <option value="">{t("paymentModeDefault")}</option>
            <option value="SESSION">{tm("SESSION")}</option>
            <option value="MONTH">{tm("MONTH")}</option>
            <option value="TERM">{tm("TERM")}</option>
          </Select>
        </FormField>
      </div>
      {/* Home pickup point — a pin here is what opts the teacher into transport
          planning: house-to-house legs start and end at this address. */}
      <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-muted-foreground">{t("homeLocation")}</p>
          <MapPicker
            value={
              lat && lng && !Number.isNaN(parseFloat(lat)) && !Number.isNaN(parseFloat(lng))
                ? { lat: parseFloat(lat), lng: parseFloat(lng) }
                : null
            }
            onPick={(v, addr) => {
              setLat(v.lat.toFixed(6));
              setLng(v.lng.toFixed(6));
              if (addr && !address.trim()) setAddress(addr);
            }}
            trigger={
              <Button type="button" variant="secondary" size="sm" className="gap-1">
                <Map className="size-3.5" />
                {t("locateOnMap")}
              </Button>
            }
          />
        </div>
        <FormField label={t("address")} htmlFor="t-address" hint={t("homeHint")}>
          <Input id="t-address" name="address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </FormField>
        <input type="hidden" name="homeLat" value={lat} />
        <input type="hidden" name="homeLng" value={lng} />
        {lat && lng && (
          <p className="text-xs tabular-nums text-muted-foreground" dir="ltr">
            {lat}, {lng}
          </p>
        )}
      </div>
      <FormField label={tc("notes")} htmlFor="notes">
        <Input id="notes" name="notes" defaultValue={teacher?.notes ?? ""} />
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={teacher?.active ?? true}
          className="size-4 accent-[var(--primary)]"
        />
        {tc("active")}
      </label>
    </>
  );
}

function SubjectsPicker({ subjects, initial }: { subjects: SubjectOpt[]; initial: string[] }) {
  const t = useTranslations("teachers");
  const [ids, setIds] = useState<string[]>(initial);
  if (subjects.length === 0) return null;
  return (
    <FormField label={t("subjects")} htmlFor="subjectIds" hint={t("subjectsHint")}>
      <MultiSelect
        id="subjectIds"
        name="subjectIds"
        options={subjects.map((s) => ({ value: s.id, label: s.label }))}
        value={ids}
        onChange={setIds}
        placeholder={t("noSubjects")}
      />
    </FormField>
  );
}

export function TeachersClient({ teachers, subjects }: { teachers: TeacherRow[]; subjects: SubjectOpt[] }) {
  const t = useTranslations("teachers");
  const tc = useTranslations("common");
  const tp = useTranslations("profile");
  const locale = useLocale();
  const search = useTableSearch(teachers, (x) => [nameSearchText(x), x.phone, x.notes, ...x.subjectLabels]);
  const columns = useMemo<ColumnDef<TeacherRow>[]>(
    () => [
      { key: "name", label: tc("name"), value: (x) => displayName(x, locale) },
      { key: "phone", label: tc("phone"), value: (x) => x.phone },
      { key: "commissionPct", label: t("commissionPct"), type: "number", value: (x) => x.commissionPct },
      { key: "subjects", label: t("subjects"), value: (x) => x.subjectLabels.join("، ") },
      {
        key: "status",
        label: tc("status"),
        type: "enum",
        value: (x) => (x.active ? "active" : "inactive"),
        filterable: true,
        options: ["active", "inactive"],
        optionLabel: (v) => tc(v as "active"),
      },
      { key: "actions", label: tc("actions") },
    ],
    [t, tc],
  );
  const sf = useTableSortFilter(search.filtered, columns);
  const pg = usePagination(sf.rows, 20, sf.version);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <TableSearch
          value={search.query}
          onChange={search.setQuery}
          resultCount={search.filtered.length}
          placeholder={t("searchPlaceholder")}
        />
        <EntityDialog
          title={t("add")}
          action={saveTeacher.bind(null, locale, null)}
          fields={<TeacherFields subjects={subjects} />}
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
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((teacher) => (
              <TableRow key={teacher.id}>
                <TableCell className="font-medium">{displayName(teacher, locale)}</TableCell>
                <TableCell><span dir="ltr">{teacher.phone ?? "—"}</span></TableCell>
                <TableCell className="tabular-nums">{teacher.commissionPct}%</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {teacher.subjectLabels.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      teacher.subjectLabels.map((label) => (
                        <Badge key={label} variant="default">{label}</Badge>
                      ))
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {teacher.active ? (
                    <Badge variant="success">{tc("active")}</Badge>
                  ) : (
                    <Badge variant="muted">{tc("inactive")}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex justify-center gap-1">
                    <Link href={`/teachers/${teacher.id}`}>
                      <Button variant="ghost" size="icon" aria-label={tp("view360")}>
                        <CircleUserRound className="size-4" />
                      </Button>
                    </Link>
                    <EntityDialog
                      title={t("edit")}
                      action={saveTeacher.bind(null, locale, teacher.id)}
                      fields={<TeacherFields teacher={teacher} subjects={subjects} />}
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    <DeleteButton action={deleteTeacher.bind(null, locale, teacher.id)} />
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
