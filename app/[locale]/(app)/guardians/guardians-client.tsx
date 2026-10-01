"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  CircleUserRound,
  House,
  Map as MapIcon,
  Pencil,
  Plus,
  Star,
  Trash2,
  UsersRound,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { DeleteButton } from "@/components/crud/delete-button";
import { FormField } from "@/components/crud/form-field";
import { MapPicker } from "@/components/map-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
import {
  bulkCreateGuardianStudents,
  deleteGuardian,
  saveGuardian,
  type CreatedGuardianResult,
} from "./actions";
import { displayName, nameSearchText } from "@/lib/names";
import {
  MAX_BULK_GUARDIAN_STUDENTS,
  MAX_GUARDIAN_HOMES,
} from "@/lib/guardian-homes";

export type GuardianHomeRow = {
  id: string;
  label: string;
  address: string | null;
  homeCode: string | null;
  homeLat: number | null;
  homeLng: number | null;
  isDefault: boolean;
  sortOrder: number;
};

export type GuardianRow = {
  id: string;
  name: string;
  nameEn: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  studentCount: number;
  homes: GuardianHomeRow[];
};

export type GradeOption = { id: string; label: string };

type HomeDraft = {
  key: string;
  id: string | null;
  label: string;
  address: string;
  homeCode: string;
  homeLat: string;
  homeLng: string;
  isDefault: boolean;
};

type BulkStudentDraft = {
  key: string;
  name: string;
  nameEn: string;
  gradeLevelId: string;
  gradeYear: string;
};

let draftSequence = 0;
const draftKey = (prefix: string) => `${prefix}-${++draftSequence}`;

function newHome(isDefault: boolean, key = draftKey("home")): HomeDraft {
  return {
    key,
    id: null,
    label: "",
    address: "",
    homeCode: "",
    homeLat: "",
    homeLng: "",
    isDefault,
  };
}

function newBulkStudent(): BulkStudentDraft {
  return {
    key: draftKey("student"),
    name: "",
    nameEn: "",
    gradeLevelId: "",
    gradeYear: "",
  };
}

function GuardianFields({ guardian }: { guardian?: GuardianRow }) {
  const t = useTranslations("guardians");
  const tc = useTranslations("common");
  const ts = useTranslations("students");
  const [homes, setHomes] = useState<HomeDraft[]>(() =>
    guardian
      ? guardian.homes.map((home) => ({
          key: home.id,
          id: home.id,
          label: home.label,
          address: home.address ?? "",
          homeCode: home.homeCode ?? "",
          homeLat: home.homeLat == null ? "" : String(home.homeLat),
          homeLng: home.homeLng == null ? "" : String(home.homeLng),
          isDefault: home.isDefault,
        }))
      : [newHome(true, "new-home-initial")],
  );

  const updateHome = (key: string, patch: Partial<HomeDraft>) =>
    setHomes((current) =>
      current.map((home) => (home.key === key ? { ...home, ...patch } : home)),
    );

  const makeDefault = (key: string) =>
    setHomes((current) =>
      current.map((home) => ({ ...home, isDefault: home.key === key })),
    );

  const removeHome = (key: string) =>
    setHomes((current) => {
      const removedWasDefault = current.find((home) => home.key === key)?.isDefault;
      const next = current.filter((home) => home.key !== key);
      if (removedWasDefault && next.length) next[0] = { ...next[0], isDefault: true };
      return next;
    });

  const submittedHomes = homes.map((home) => ({
    id: home.id,
    label: home.label,
    address: home.address,
    homeCode: home.homeCode,
    homeLat: home.homeLat,
    homeLng: home.homeLng,
    isDefault: home.isDefault,
  }));

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={tc("nameAr")} htmlFor="name">
          <Input id="name" name="name" defaultValue={guardian?.name} required maxLength={120} />
        </FormField>
        <FormField label={tc("nameEn")} htmlFor="nameEn" hint={tc("nameEnHint")}>
          <Input id="nameEn" name="nameEn" dir="ltr" defaultValue={guardian?.nameEn ?? ""} maxLength={120} />
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={tc("phone")} htmlFor="phone">
          <Input id="phone" name="phone" dir="ltr" defaultValue={guardian?.phone ?? ""} maxLength={40} />
        </FormField>
        <FormField label={tc("email")} htmlFor="email">
          <Input id="email" name="email" type="email" dir="ltr" defaultValue={guardian?.email ?? ""} maxLength={254} />
        </FormField>
      </div>
      <FormField label={tc("notes")} htmlFor="notes">
        <Input id="notes" name="notes" defaultValue={guardian?.notes ?? ""} maxLength={1_000} />
      </FormField>

      <input type="hidden" name="homesJson" value={JSON.stringify(submittedHomes)} />
      <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <House className="size-4 text-primary" />
              {t("homes")}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("homesHint")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={homes.length >= MAX_GUARDIAN_HOMES}
            onClick={() => setHomes((current) => [...current, newHome(current.length === 0)])}
          >
            <Plus className="size-3.5" />
            {t("addHome")}
          </Button>
        </div>

        {homes.length === 0 && (
          <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
            {t("noHomesHint")}
          </p>
        )}

        {homes.map((home, index) => {
          const suffix = home.key.replace(/[^a-zA-Z0-9_-]/g, "");
          const labelId = `guardian-home-label-${suffix}`;
          const addressId = `guardian-home-address-${suffix}`;
          return (
            <div key={home.key} className="space-y-3 rounded-md border border-border bg-card p-3">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <FormField label={t("homeLabel")} htmlFor={labelId}>
                    <Input
                      id={labelId}
                      value={home.label}
                      maxLength={80}
                      placeholder={t("homeLabelPlaceholder", { n: index + 1 })}
                      onChange={(event) => updateHome(home.key, { label: event.target.value })}
                    />
                  </FormField>
                </div>
                <label className="mt-7 flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border px-2 text-xs">
                  <input
                    type="radio"
                    checked={home.isDefault}
                    onChange={() => makeDefault(home.key)}
                    className="size-4 accent-[var(--primary)]"
                  />
                  <Star className="size-3.5" />
                  {t("defaultHome")}
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-7 text-destructive"
                  aria-label={t("removeHome")}
                  onClick={() => removeHome(home.key)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>

              <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto]">
                <FormField label={t("homeAddress")} htmlFor={addressId}>
                  <Input
                    id={addressId}
                    value={home.address}
                    maxLength={500}
                    onChange={(event) => updateHome(home.key, { address: event.target.value })}
                  />
                </FormField>
                <MapPicker
                  value={
                    home.homeLat && home.homeLng &&
                    !Number.isNaN(Number(home.homeLat)) && !Number.isNaN(Number(home.homeLng))
                      ? { lat: Number(home.homeLat), lng: Number(home.homeLng) }
                      : null
                  }
                  onPick={(point, address) =>
                    updateHome(home.key, {
                      homeLat: point.lat.toFixed(6),
                      homeLng: point.lng.toFixed(6),
                      address: address && !home.address.trim() ? address : home.address,
                    })
                  }
                  trigger={
                    <Button type="button" variant="secondary" className="gap-1">
                      <MapIcon className="size-4" />
                      {ts("locateOnMap")}
                    </Button>
                  }
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <FormField label={t("homeCode")} htmlFor={`guardian-home-code-${suffix}`}>
                  <Input
                    id={`guardian-home-code-${suffix}`}
                    value={home.homeCode}
                    maxLength={40}
                    onChange={(event) => updateHome(home.key, { homeCode: event.target.value })}
                  />
                </FormField>
                <FormField label={ts("homeLat")} htmlFor={`guardian-home-lat-${suffix}`}>
                  <Input
                    id={`guardian-home-lat-${suffix}`}
                    dir="ltr"
                    inputMode="decimal"
                    value={home.homeLat}
                    onChange={(event) => updateHome(home.key, { homeLat: event.target.value })}
                  />
                </FormField>
                <FormField label={ts("homeLng")} htmlFor={`guardian-home-lng-${suffix}`}>
                  <Input
                    id={`guardian-home-lng-${suffix}`}
                    dir="ltr"
                    inputMode="decimal"
                    value={home.homeLng}
                    onChange={(event) => updateHome(home.key, { homeLng: event.target.value })}
                  />
                </FormField>
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}

function BulkGuardianStudentsDialog({
  guardian,
  gradeLevels,
  onClose,
}: {
  guardian: CreatedGuardianResult;
  gradeLevels: GradeOption[];
  onClose: () => void;
}) {
  const t = useTranslations("guardians");
  const tc = useTranslations("common");
  const ts = useTranslations("students");
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<BulkStudentDraft[]>(() => [newBulkStudent()]);
  const [applyGradeLevel, setApplyGradeLevel] = useState("");
  const [applyGradeYear, setApplyGradeYear] = useState("");
  const defaultHome = guardian.homes.find((home) => home.isDefault) ?? guardian.homes[0];
  const [homeId, setHomeId] = useState(defaultHome?.id ?? "");

  const updateRow = (key: string, patch: Partial<BulkStudentDraft>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );

  function applyGradesToAll() {
    if (!applyGradeLevel && !applyGradeYear) return;
    setRows((current) =>
      current.map((row) => ({
        ...row,
        gradeLevelId: applyGradeLevel || row.gradeLevelId,
        gradeYear: applyGradeYear || row.gradeYear,
      })),
    );
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    start(async () => {
      const result = await bulkCreateGuardianStudents(locale, guardian.id, {}, formData);
      if (result.ok) onClose();
      else setError(result.error ?? "invalid");
    });
  }

  const submittedRows = rows.map((row) => ({
    name: row.name,
    nameEn: row.nameEn,
    gradeLevelId: row.gradeLevelId,
    gradeYear: row.gradeYear,
  }));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UsersRound className="size-5 text-primary" />
            {t("bulkStudentsTitle", { name: displayName(guardian, locale) })}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">{t("bulkStudentsHint")}</p>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" name="studentsJson" value={JSON.stringify(submittedRows)} />

          {guardian.homes.length > 0 ? (
            <FormField label={t("studentHome")} htmlFor="bulk-guardian-home" hint={t("studentHomeHint")}>
              <Select
                id="bulk-guardian-home"
                name="guardianHomeId"
                value={homeId}
                onChange={(event) => setHomeId(event.target.value)}
              >
                {guardian.homes.map((home) => (
                  <option key={home.id} value={home.id}>
                    {home.label}{home.address ? ` — ${home.address}` : ""}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : (
            <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
              {t("bulkNoHome")}
            </div>
          )}

          <div className="grid items-end gap-2 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-[1fr_1fr_auto]">
            <FormField label={t("applyGradeLevel")} htmlFor="bulk-apply-level">
              <Select
                id="bulk-apply-level"
                value={applyGradeLevel}
                onChange={(event) => setApplyGradeLevel(event.target.value)}
              >
                <option value="">—</option>
                {gradeLevels.map((grade) => (
                  <option key={grade.id} value={grade.id}>{grade.label}</option>
                ))}
              </Select>
            </FormField>
            <FormField label={t("applyGradeYear")} htmlFor="bulk-apply-year">
              <Select
                id="bulk-apply-year"
                value={applyGradeYear}
                onChange={(event) => setApplyGradeYear(event.target.value)}
              >
                <option value="">—</option>
                {Array.from({ length: 12 }, (_, index) => index + 1).map((grade) => (
                  <option key={grade} value={grade}>{ts("gradeYearN", { n: grade })}</option>
                ))}
              </Select>
            </FormField>
            <Button type="button" variant="secondary" onClick={applyGradesToAll}>
              {t("applyToAll")}
            </Button>
          </div>

          <div className="max-h-[42dvh] space-y-2 overflow-y-auto overscroll-contain pe-1">
            {rows.map((row, index) => (
              <div
                key={row.key}
                className="grid items-end gap-2 rounded-md border border-border p-3 sm:grid-cols-[auto_1.3fr_1.3fr_1fr_1fr_auto]"
              >
                <span className="pb-2 text-sm font-semibold text-muted-foreground">{index + 1}</span>
                <FormField label={tc("nameAr")} htmlFor={`bulk-name-${row.key}`}>
                  <Input
                    id={`bulk-name-${row.key}`}
                    value={row.name}
                    required
                    maxLength={120}
                    onChange={(event) => updateRow(row.key, { name: event.target.value })}
                  />
                </FormField>
                <FormField label={tc("nameEn")} htmlFor={`bulk-name-en-${row.key}`}>
                  <Input
                    id={`bulk-name-en-${row.key}`}
                    dir="ltr"
                    value={row.nameEn}
                    maxLength={120}
                    onChange={(event) => updateRow(row.key, { nameEn: event.target.value })}
                  />
                </FormField>
                <FormField label={ts("gradeLevel")} htmlFor={`bulk-level-${row.key}`}>
                  <Select
                    id={`bulk-level-${row.key}`}
                    value={row.gradeLevelId}
                    onChange={(event) => updateRow(row.key, { gradeLevelId: event.target.value })}
                  >
                    <option value="">—</option>
                    {gradeLevels.map((grade) => (
                      <option key={grade.id} value={grade.id}>{grade.label}</option>
                    ))}
                  </Select>
                </FormField>
                <FormField label={ts("gradeYear")} htmlFor={`bulk-year-${row.key}`}>
                  <Select
                    id={`bulk-year-${row.key}`}
                    value={row.gradeYear}
                    onChange={(event) => updateRow(row.key, { gradeYear: event.target.value })}
                  >
                    <option value="">—</option>
                    {Array.from({ length: 12 }, (_, gradeIndex) => gradeIndex + 1).map((grade) => (
                      <option key={grade} value={grade}>{grade}</option>
                    ))}
                  </Select>
                </FormField>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  disabled={rows.length === 1}
                  aria-label={t("removeStudentRow")}
                  onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={rows.length >= MAX_BULK_GUARDIAN_STUDENTS}
            onClick={() => setRows((current) => [...current, newBulkStudent()])}
          >
            <Plus className="size-4" />
            {t("addStudentRow")}
          </Button>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {t.has(`errors.${error}`) ? t(`errors.${error}`) : tc("required")}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("skipStudents")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? tc("saving") : t("createStudents")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateGuardianDialog({ gradeLevels }: { gradeLevels: GradeOption[] }) {
  const t = useTranslations("guardians");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [bulkGuardian, setBulkGuardian] = useState<CreatedGuardianResult | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    start(async () => {
      const result = await saveGuardian(locale, null, {}, formData);
      if (result.ok && result.createdGuardian) {
        setOpen(false);
        setBulkGuardian(result.createdGuardian);
      } else {
        setError(result.error ?? "invalid");
      }
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button className="gap-2">
            <Plus className="size-4" />
            {t("add")}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("add")}</DialogTitle>
          </DialogHeader>
          <form key={String(open)} onSubmit={onSubmit} className="space-y-3">
            <GuardianFields />
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {t.has(`errors.${error}`) ? t(`errors.${error}`) : tc("required")}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">{tc("cancel")}</Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? tc("saving") : tc("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {bulkGuardian && (
        <BulkGuardianStudentsDialog
          guardian={bulkGuardian}
          gradeLevels={gradeLevels}
          onClose={() => setBulkGuardian(null)}
        />
      )}
    </>
  );
}

export function GuardiansClient({
  guardians,
  gradeLevels,
  canManage,
}: {
  guardians: GuardianRow[];
  gradeLevels: GradeOption[];
  canManage: boolean;
}) {
  const t = useTranslations("guardians");
  const tc = useTranslations("common");
  const tp = useTranslations("profile");
  const locale = useLocale();
  const search = useTableSearch(guardians, (guardian) => [
    nameSearchText(guardian),
    guardian.phone,
    guardian.email,
    guardian.notes,
    ...guardian.homes.flatMap((home) => [home.label, home.address, home.homeCode]),
  ]);
  const columns = useMemo<ColumnDef<GuardianRow>[]>(
    () => [
      { key: "name", label: tc("name"), value: (guardian) => displayName(guardian, locale) },
      { key: "phone", label: tc("phone"), value: (guardian) => guardian.phone },
      { key: "email", label: tc("email"), value: (guardian) => guardian.email },
      { key: "homes", label: t("homes"), type: "number", value: (guardian) => guardian.homes.length },
      { key: "students", label: t("students"), type: "number", value: (guardian) => guardian.studentCount },
      { key: "actions", label: tc("actions") },
    ],
    [locale, t, tc],
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
        {canManage && <CreateGuardianDialog gradeLevels={gradeLevels} />}
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
            {pg.pageItems.map((guardian) => (
              <TableRow key={guardian.id}>
                <TableCell className="font-medium">
                  <Link href={`/guardians/${guardian.id}`} className="text-primary hover:underline">
                    {displayName(guardian, locale)}
                  </Link>
                </TableCell>
                <TableCell><span dir="ltr">{guardian.phone ?? "—"}</span></TableCell>
                <TableCell><span dir="ltr">{guardian.email ?? "—"}</span></TableCell>
                <TableCell className="tabular-nums" title={guardian.homes.map((home) => home.label).join(", ")}>
                  {guardian.homes.length}
                </TableCell>
                <TableCell className="tabular-nums">
                  <Link href={`/guardians/${guardian.id}?tab=children`} className="text-primary hover:underline">
                    {guardian.studentCount}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex justify-center gap-1">
                    <Link href={`/guardians/${guardian.id}`}>
                      <Button variant="ghost" size="icon" aria-label={tp("view360")}>
                        <CircleUserRound className="size-4" />
                      </Button>
                    </Link>
                    {canManage && (
                      <>
                        <EntityDialog
                          title={t("edit")}
                          extraWide
                          action={saveGuardian.bind(null, locale, guardian.id)}
                          fields={<GuardianFields guardian={guardian} />}
                          trigger={
                            <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                              <Pencil className="size-4" />
                            </Button>
                          }
                        />
                        <DeleteButton action={deleteGuardian.bind(null, locale, guardian.id)} />
                      </>
                    )}
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
