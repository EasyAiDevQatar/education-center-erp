"use client";

import { useState , useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, CircleUserRound, MapPin, Map } from "lucide-react";
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
import { MapPicker } from "@/components/map-picker";
import { saveStudent, deleteStudent } from "./actions";
import { displayName, nameSearchText } from "@/lib/names";

export type Option = { id: string; label: string };
export type StudentRow = {
  id: string;
  name: string;
  nameEn: string | null;
  phone: string | null;
  gradeLevelId: string | null;
  gradeLevelLabel: string | null;
  gradeYear: number | null;
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
        <FormField label={t("studyLocation")} htmlFor="studyLocation" hint={t("studyLocationHint")}>
          <Select id="studyLocation" name="studyLocation" defaultValue={student?.studyLocation ?? "CENTER"}>
            <option value="CENTER">{te("location.CENTER")}</option>
            <option value="HOME">{te("location.HOME")}</option>
          </Select>
        </FormField>
      </div>
      <FormField label={t("guardian")} htmlFor="guardianId">
        <Combobox
          id="guardianId"
          name="guardianId"
          options={guardians.map((g) => ({ value: g.id, label: g.label }))}
          value={guardianId}
          onChange={setGuardianId}
        />
      </FormField>
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
                  <Map className="size-3.5" />
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
}: {
  students: StudentRow[];
  levels: Option[];
  guardians: Option[];
  teachers: Option[];
}) {
  const t = useTranslations("students");
  const tc = useTranslations("common");
  const tp = useTranslations("profile");
  const te = useTranslations("enums");
  const locale = useLocale();
  const search = useTableSearch(students, (s) => [nameSearchText(s), s.phone, s.gradeLevelLabel, s.guardianLabel, s.homeCode]);
  const columns = useMemo<ColumnDef<StudentRow>[]>(
    () => [
      { key: "name", label: tc("name"), value: (s) => displayName(s, locale) },
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
    [t, tc, te],
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
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{displayName(s, locale)}</TableCell>
                <TableCell>{s.gradeLevelLabel ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{s.gradeYear ?? "—"}</TableCell>
                <TableCell>{s.guardianLabel ?? "—"}</TableCell>
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
