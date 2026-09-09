"use client";

import { useCallback, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, CircleUserRound, MapPin, Map as MapIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { DeleteButton } from "@/components/crud/delete-button";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { MultiSelect } from "@/components/ui/multi-select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
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
import { MapPicker } from "@/components/map-picker";
import { saveStudent, deleteStudent } from "./actions";
import { displayName, nameSearchText } from "@/lib/names";
import { formatMoney } from "@/lib/money";
import { referenceCode } from "@/lib/reference-code";

export type Option = { id: string; label: string };
export type StudentRow = {
  id: string;
  referenceNo: number;
  name: string;
  nameEn: string | null;
  phone: string | null;
  gradeLevelId: string | null;
  gradeLevelLabel: string | null;
  gradeYear: number | null;
  specialPricePerHour: number | null;
  guardianId: string | null;
  guardianLabel: string | null;
  studyLocation: "CENTER" | "HOME";
  active: boolean;
  notes: string | null;
  address: string | null;
  homeLat: number | null;
  homeLng: number | null;
  checkinPin: string | null;
  homeCode: string | null;
  /** Teacher ids assigned for the current academic year. */
  teacherIds: string[];
  /** Separate commercial scope for the student's special price. */
  specialPriceTeacherIds: string[];
};

function StudentFields({
  student,
  levels,
  guardians,
  teachers,
}: {
  student?: StudentRow;
  levels: Option[];
  guardians: Option[];
  teachers: Option[];
}) {
  const t = useTranslations("students");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const [lat, setLat] = useState(student?.homeLat != null ? String(student.homeLat) : "");
  const [lng, setLng] = useState(student?.homeLng != null ? String(student.homeLng) : "");
  const [address, setAddress] = useState(student?.address ?? "");
  const [guardianId, setGuardianId] = useState(student?.guardianId ?? "");
  const [teacherIds, setTeacherIds] = useState<string[]>(student?.teacherIds ?? []);
  const [specialPriceTeacherIds, setSpecialPriceTeacherIds] = useState<string[]>(student?.specialPriceTeacherIds ?? []);

  function useCurrentLocation() {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
      },
      undefined,
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={tc("nameAr")} htmlFor="name">
          <Input id="name" name="name" defaultValue={student?.name} required />
        </FormField>
        <FormField label={tc("nameEn")} htmlFor="nameEn" hint={tc("nameEnHint")}>
          <Input id="nameEn" name="nameEn" dir="ltr" defaultValue={student?.nameEn ?? ""} />
        </FormField>
      </div>
      <FormField label={tc("phone")} htmlFor="phone">
        <Input id="phone" name="phone" dir="ltr" defaultValue={student?.phone ?? ""} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("gradeLevel")} htmlFor="gradeLevelId">
          <Select id="gradeLevelId" name="gradeLevelId" defaultValue={student?.gradeLevelId ?? ""}>
            <option value="">—</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("gradeYear")} htmlFor="gradeYear" hint={t("gradeYearHint")}>
          <Select id="gradeYear" name="gradeYear" defaultValue={student?.gradeYear != null ? String(student.gradeYear) : ""}>
            <option value="">—</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{t("gradeYearN", { n })}</option>
            ))}
          </Select>
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("studyLocation")} htmlFor="studyLocation" hint={t("studyLocationHint")}>
          <Select id="studyLocation" name="studyLocation" defaultValue={student?.studyLocation ?? "CENTER"}>
            <option value="CENTER">{te("location.CENTER")}</option>
            <option value="HOME">{te("location.HOME")}</option>
          </Select>
        </FormField>
        <FormField label={t("guardian")} htmlFor="guardianId">
          <Combobox
            id="guardianId"
            name="guardianId"
            options={guardians.map((g) => ({ value: g.id, label: g.label }))}
            value={guardianId}
            onChange={setGuardianId}
          />
        </FormField>
      </div>
      <div className="grid items-start gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
        <FormField label={t("specialPrice")} htmlFor="specialPricePerHour" hint={t("specialPriceHint")}>
          <Input
            id="specialPricePerHour"
            name="specialPricePerHour"
            type="number"
            min="0"
            step="0.01"
            dir="ltr"
            placeholder={t("matrixPrice")}
            defaultValue={student?.specialPricePerHour ?? ""}
          />
        </FormField>
        <FormField
          label={t("specialPriceTeachers")}
          htmlFor="specialPriceTeacherIds"
          hint={t("specialPriceTeachersHint")}
        >
          <MultiSelect
            id="specialPriceTeacherIds"
            name="specialPriceTeacherIds"
            options={teachers.map((x) => ({ value: x.id, label: x.label }))}
            value={specialPriceTeacherIds}
            onChange={setSpecialPriceTeacherIds}
            placeholder={t("allTeachers")}
          />
        </FormField>
      </div>
      <FormField label={t("assignedTeachers")} htmlFor="teacherIds" hint={t("assignedTeachersHint")}>
        <MultiSelect
          id="teacherIds"
          name="teacherIds"
          options={teachers.map((x) => ({ value: x.id, label: x.label }))}
          value={teacherIds}
          onChange={setTeacherIds}
          placeholder={t("noTeachersAssigned")}
        />
      </FormField>
      <FormField label={tc("notes")} htmlFor="notes">
        <Input id="notes" name="notes" defaultValue={student?.notes ?? ""} />
      </FormField>

      {/* Home-session attendance settings */}
      <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-muted-foreground">{t("homeLocation")}</p>
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={useCurrentLocation}>
              <MapPin className="size-3.5" />
              {t("useCurrentLocation")}
            </Button>
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
                  <MapIcon className="size-3.5" />
                  {t("locateOnMap")}
                </Button>
              }
            />
          </div>
        </div>
        <FormField label={t("address")} htmlFor="address">
          <Input
            id="address"
            name="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("homeLat")} htmlFor="homeLat">
            <Input id="homeLat" name="homeLat" dir="ltr" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
          </FormField>
          <FormField label={t("homeLng")} htmlFor="homeLng">
            <Input id="homeLng" name="homeLng" dir="ltr" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label={t("checkinPin")} htmlFor="checkinPin">
            <Input id="checkinPin" name="checkinPin" dir="ltr" inputMode="numeric" maxLength={6} placeholder="4–6" defaultValue={student?.checkinPin ?? ""} />
          </FormField>
          <FormField label={t("homeCode")} htmlFor="homeCode" hint={t("homeCodeHint")}>
            <Input id="homeCode" name="homeCode" maxLength={40} defaultValue={student?.homeCode ?? ""} />
          </FormField>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={student?.active ?? true} className="size-4 accent-[var(--primary)]" />
        {tc("active")}
      </label>
    </>
  );
}

export function StudentsClient({
  students,
  levels,
  guardians,
  teachers,
  currency,
}: {
  students: StudentRow[];
  levels: Option[];
  guardians: Option[];
  teachers: Option[];
  currency: string;
}) {
  const t = useTranslations("students");
  const tc = useTranslations("common");
  const tp = useTranslations("profile");
  const te = useTranslations("enums");
  const locale = useLocale();
  const teacherById = useMemo(
    () => new Map(teachers.map((teacher) => [teacher.id, teacher.label])),
    [teachers],
  );
  const specialTeacherNames = useCallback(
    (student: StudentRow) =>
      student.specialPriceTeacherIds.map((id) => teacherById.get(id)).filter(Boolean).join("، "),
    [teacherById],
  );
  const search = useTableSearch(students, (s) => [
    referenceCode("student", s.referenceNo),
    nameSearchText(s),
    s.phone,
    s.gradeLevelLabel,
    s.guardianLabel,
    s.homeCode,
    s.specialPricePerHour == null ? null : String(s.specialPricePerHour),
    specialTeacherNames(s),
  ]);
  const columns = useMemo<ColumnDef<StudentRow>[]>(
    () => [
      { key: "code", label: t("studentCode"), value: (s) => referenceCode("student", s.referenceNo) },
      { key: "name", label: tc("name"), value: (s) => displayName(s, locale) },
      {
        key: "specialPrice",
        label: t("specialPrice"),
        type: "number",
        value: (s) => s.specialPricePerHour,
      },
      {
        key: "specialPriceTeachers",
        label: t("specialPriceTeachers"),
        value: (s) => s.specialPricePerHour == null ? null : specialTeacherNames(s) || t("allTeachers"),
      },
      { key: "level", label: t("gradeLevel"), value: (s) => s.gradeLevelLabel, filterable: true },
      {
        key: "gradeYear",
        label: t("gradeYear"),
        value: (s) => (s.gradeYear != null ? String(s.gradeYear) : null),
        filterable: true,
      },
      { key: "guardian", label: t("guardian"), value: (s) => s.guardianLabel, filterable: true },
      { key: "phone", label: tc("phone"), value: (s) => s.phone },
      {
        key: "studyLocation",
        label: t("studyLocation"),
        type: "enum",
        value: (s) => s.studyLocation,
        filterable: true,
        options: ["CENTER", "HOME"],
        optionLabel: (v) => te(`location.${v as "CENTER"}`),
      },
      {
        key: "status",
        label: tc("status"),
        type: "enum",
        value: (s) => (s.active ? "active" : "inactive"),
        filterable: true,
        options: ["active", "inactive"],
        optionLabel: (v) => tc(v as "active"),
      },
      { key: "actions", label: tc("actions") },
    ],
    [t, tc, te, locale, specialTeacherNames],
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
          extraWide
          action={saveStudent.bind(null, locale, null)}
          fields={<StudentFields levels={levels} guardians={guardians} teachers={teachers} />}
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
                <TableCell colSpan={11} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="whitespace-nowrap font-medium tabular-nums">
                  <Link href={`/students/${s.id}`} className="text-primary hover:underline" dir="ltr">
                    {referenceCode("student", s.referenceNo)}
                  </Link>
                </TableCell>
                <TableCell className="font-medium">
                  <Link href={`/students/${s.id}`} className="hover:text-primary hover:underline">
                    {displayName(s, locale)}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {s.specialPricePerHour == null ? "—" : `${formatMoney(s.specialPricePerHour)} ${currency}`}
                </TableCell>
                <TableCell>
                  {s.specialPricePerHour == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : s.specialPriceTeacherIds.length === 0 ? (
                    <Badge variant="muted">{t("allTeachers")}</Badge>
                  ) : (
                    <div className="flex min-w-48 flex-wrap gap-1">
                      {s.specialPriceTeacherIds.map((teacherId) => (
                        <Link key={teacherId} href={`/teachers/${teacherId}`}>
                          <Badge variant="default" className="hover:underline">
                            {teacherById.get(teacherId) ?? "—"}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell>{s.gradeLevelLabel ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{s.gradeYear ?? "—"}</TableCell>
                <TableCell>
                  {s.guardianId && s.guardianLabel ? (
                    <Link href={`/guardians/${s.guardianId}`} className="hover:text-primary hover:underline">
                      {s.guardianLabel}
                    </Link>
                  ) : "—"}
                </TableCell>
                <TableCell><span dir="ltr">{s.phone ?? "—"}</span></TableCell>
                <TableCell>
                  <Badge variant={s.studyLocation === "HOME" ? "warning" : "default"}>
                    {te(`location.${s.studyLocation}`)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {s.active ? (
                    <Badge variant="success">{tc("active")}</Badge>
                  ) : (
                    <Badge variant="muted">{tc("inactive")}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex justify-center gap-1">
                    <Link href={`/students/${s.id}`}>
                      <Button variant="ghost" size="icon" aria-label={tp("view360")}>
                        <CircleUserRound className="size-4" />
                      </Button>
                    </Link>
                    <EntityDialog
                      title={t("edit")}
                      extraWide
                      action={saveStudent.bind(null, locale, s.id)}
                      fields={<StudentFields student={s} levels={levels} guardians={guardians} teachers={teachers} />}
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    <DeleteButton action={deleteStudent.bind(null, locale, s.id)} />
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
