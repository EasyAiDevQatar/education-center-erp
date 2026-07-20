"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, CircleUserRound, MapPin, Map } from "lucide-react";
import { Link } from "@/i18n/navigation";
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
import { MapPicker } from "@/components/map-picker";
import { saveStudent, deleteStudent } from "./actions";

export type Option = { id: string; label: string };
export type StudentRow = {
  id: string;
  name: string;
  phone: string | null;
  gradeLevelId: string | null;
  gradeLevelLabel: string | null;
  guardianId: string | null;
  guardianLabel: string | null;
  active: boolean;
  notes: string | null;
  address: string | null;
  homeLat: number | null;
  homeLng: number | null;
  checkinPin: string | null;
  homeCode: string | null;
};

function StudentFields({
  student,
  levels,
  guardians,
}: {
  student?: StudentRow;
  levels: Option[];
  guardians: Option[];
}) {
  const t = useTranslations("students");
  const tc = useTranslations("common");
  const [lat, setLat] = useState(student?.homeLat != null ? String(student.homeLat) : "");
  const [lng, setLng] = useState(student?.homeLng != null ? String(student.homeLng) : "");
  const [address, setAddress] = useState(student?.address ?? "");

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
      <FormField label={tc("name")} htmlFor="name">
        <Input id="name" name="name" defaultValue={student?.name} required />
      </FormField>
      <FormField label={tc("phone")} htmlFor="phone">
        <Input id="phone" name="phone" dir="ltr" defaultValue={student?.phone ?? ""} />
      </FormField>
      <FormField label={t("gradeLevel")} htmlFor="gradeLevelId">
        <Select id="gradeLevelId" name="gradeLevelId" defaultValue={student?.gradeLevelId ?? ""}>
          <option value="">—</option>
          {levels.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </Select>
      </FormField>
      <FormField label={t("guardian")} htmlFor="guardianId">
        <Select id="guardianId" name="guardianId" defaultValue={student?.guardianId ?? ""}>
          <option value="">—</option>
          {guardians.map((g) => (
            <option key={g.id} value={g.id}>{g.label}</option>
          ))}
        </Select>
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
}: {
  students: StudentRow[];
  levels: Option[];
  guardians: Option[];
}) {
  const t = useTranslations("students");
  const tc = useTranslations("common");
  const tp = useTranslations("profile");
  const locale = useLocale();
  const pg = usePagination(students);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <EntityDialog
          title={t("add")}
          action={saveStudent.bind(null, locale, null)}
          fields={<StudentFields levels={levels} guardians={guardians} />}
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
              <TableHead>{t("gradeLevel")}</TableHead>
              <TableHead>{t("guardian")}</TableHead>
              <TableHead>{tc("phone")}</TableHead>
              <TableHead>{tc("status")}</TableHead>
              <TableHead className="text-end">{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {students.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell>{s.gradeLevelLabel ?? "—"}</TableCell>
                <TableCell>{s.guardianLabel ?? "—"}</TableCell>
                <TableCell dir="ltr" className="text-start">{s.phone ?? "—"}</TableCell>
                <TableCell>
                  {s.active ? (
                    <Badge variant="success">{tc("active")}</Badge>
                  ) : (
                    <Badge variant="muted">{tc("inactive")}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-end">
                  <div className="flex justify-end gap-1">
                    <Link href={`/students/${s.id}`}>
                      <Button variant="ghost" size="icon" aria-label={tp("view360")}>
                        <CircleUserRound className="size-4" />
                      </Button>
                    </Link>
                    <EntityDialog
                      title={t("edit")}
                      action={saveStudent.bind(null, locale, s.id)}
                      fields={<StudentFields student={s} levels={levels} guardians={guardians} />}
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
