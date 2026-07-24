"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, Users2, X } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { DeleteButton } from "@/components/crud/delete-button";
import { RowActions, ViewDialog } from "@/components/crud/row-actions";
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
import { formatMoney } from "@/lib/money";
import { saveGroup, deleteGroup, setGroupMembers } from "./actions";

export type Opt = { id: string; label: string };
export type StudentOpt = { id: string; name: string; gradeYear: number | null };
export type MemberRow = { studentId: string; name: string; pricePerHour: number | null };
export type GroupRow = {
  id: string;
  name: string;
  teacherId: string | null;
  teacherName: string | null;
  subjectId: string | null;
  subjectName: string | null;
  gradeLevelId: string | null;
  gradeLabel: string | null;
  location: "CENTER" | "HOME";
  defaultPricePerHour: number | null;
  active: boolean;
  notes: string | null;
  members: MemberRow[];
};

function Fields({
  group,
  teachers,
  subjects,
  levels,
}: {
  group?: GroupRow;
  teachers: Opt[];
  subjects: Opt[];
  levels: Opt[];
}) {
  const t = useTranslations("groups");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  return (
    <>
      <FormField label={t("name")} htmlFor="g-name">
        <Input id="g-name" name="name" defaultValue={group?.name} required />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("teacher")} htmlFor="g-teacher">
          <Select id="g-teacher" name="teacherId" defaultValue={group?.teacherId ?? ""}>
            <option value="">—</option>
            {teachers.map((x) => (
              <option key={x.id} value={x.id}>{x.label}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("subject")} htmlFor="g-subject">
          <Select id="g-subject" name="subjectId" defaultValue={group?.subjectId ?? ""}>
            <option value="">—</option>
            {subjects.map((x) => (
              <option key={x.id} value={x.id}>{x.label}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("grade")} htmlFor="g-grade">
          <Select id="g-grade" name="gradeLevelId" defaultValue={group?.gradeLevelId ?? ""}>
            <option value="">—</option>
            {levels.map((x) => (
              <option key={x.id} value={x.id}>{x.label}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("location")} htmlFor="g-loc">
          <Select id="g-loc" name="location" defaultValue={group?.location ?? "CENTER"}>
            <option value="CENTER">{te("location.CENTER")}</option>
            <option value="HOME">{te("location.HOME")}</option>
          </Select>
        </FormField>
      </div>
      <FormField label={t("defaultPrice")} htmlFor="g-price" hint={t("defaultPriceHint")}>
        <Input
          id="g-price"
          name="defaultPricePerHour"
          type="number"
          step="0.5"
          min="0"
          dir="ltr"
          defaultValue={group?.defaultPricePerHour ?? ""}
        />
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={group?.active ?? true} className="size-4 accent-primary" />
        {tc("active")}
      </label>
      <FormField label={tc("notes")} htmlFor="g-notes">
        <Input id="g-notes" name="notes" defaultValue={group?.notes ?? ""} />
      </FormField>
    </>
  );
}

/** Manage the roster and each member's price. */
function MembersDialog({
  group,
  students,
  currency,
  onClose,
}: {
  group: GroupRow;
  students: StudentOpt[];
  currency: string;
  onClose: () => void;
}) {
  const t = useTranslations("groups");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();

  // studentId -> price string ("" = inherit default/matrix).
  const [rows, setRows] = useState<Record<string, string>>(
    () => Object.fromEntries(group.members.map((m) => [m.studentId, m.pricePerHour === null ? "" : String(m.pricePerHour)])),
  );
  const [q, setQ] = useState("");

  const selected = useMemo(() => new Set(Object.keys(rows)), [rows]);
  const available = useMemo(() => {
    const s = q.trim().toLowerCase();
    return students.filter((x) => !selected.has(x.id) && (!s || x.name.toLowerCase().includes(s)));
  }, [students, selected, q]);

  const add = (id: string) => setRows((p) => ({ ...p, [id]: "" }));
  const remove = (id: string) =>
    setRows((p) => {
      const n = { ...p };
      delete n[id];
      return n;
    });

  function save() {
    start(async () => {
      await setGroupMembers(locale, {
        groupId: group.id,
        members: Object.entries(rows).map(([studentId, v]) => ({
          studentId,
          pricePerHour: v.trim() === "" ? null : Math.round((parseFloat(v) || 0) * 100) / 100,
        })),
      });
      router.refresh();
      onClose();
    });
  }

  const nameOf = (id: string) => students.find((s) => s.id === id)?.name ?? id;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("membersFor", { name: group.name })}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Roster with per-student price. */}
          <div className="rounded-md border border-border">
            <p className="border-b border-border px-2 py-1.5 text-sm font-medium">
              {t("roster")} ({selected.size})
            </p>
            <ul className="max-h-72 divide-y divide-border overflow-y-auto">
              {selected.size === 0 && (
                <li className="p-3 text-center text-sm text-muted-foreground">{t("noMembers")}</li>
              )}
              {[...selected].map((id) => (
                <li key={id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <span className="flex-1 truncate">{nameOf(id)}</span>
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    dir="ltr"
                    aria-label={t("price")}
                    placeholder={group.defaultPricePerHour != null ? String(group.defaultPricePerHour) : t("matrix")}
                    className="h-7 w-20"
                    value={rows[id]}
                    onChange={(e) => setRows((p) => ({ ...p, [id]: e.target.value }))}
                  />
                  <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => remove(id)} aria-label={tc("delete")}>
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>

          {/* Add students. */}
          <div className="rounded-md border border-border">
            <div className="border-b border-border p-1.5">
              <Input placeholder={t("searchStudents")} value={q} onChange={(e) => setQ(e.target.value)} className="h-7" />
            </div>
            <ul className="max-h-72 divide-y divide-border overflow-y-auto">
              {available.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => add(s.id)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-sm hover:bg-accent"
                  >
                    <Plus className="size-3.5 text-muted-foreground" />
                    <span className="truncate">{s.name}</span>
                    {s.gradeYear != null && (
                      <Badge variant="muted" className="ms-auto">{t("gradeYearShort", { n: s.gradeYear })}</Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{t("priceHelp", { currency })}</p>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("cancel")}</Button>
          </DialogClose>
          <Button type="button" disabled={pending} onClick={save}>
            {pending ? tc("saving") : tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GroupsClient({
  groups,
  teachers,
  subjects,
  levels,
  students,
  currency,
}: {
  groups: GroupRow[];
  teachers: Opt[];
  subjects: Opt[];
  levels: Opt[];
  students: StudentOpt[];
  currency: string;
}) {
  const t = useTranslations("groups");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const [membersFor, setMembersFor] = useState<GroupRow | null>(null);

  const search = useTableSearch(groups, (g) => [g.name, g.teacherName, g.subjectName, g.gradeLabel]);
  const columns = useMemo<ColumnDef<GroupRow>[]>(
    () => [
      { key: "name", label: t("name"), value: (g) => g.name },
      { key: "teacher", label: t("teacher"), value: (g) => g.teacherName, filterable: true },
      { key: "subject", label: t("subject"), value: (g) => g.subjectName, filterable: true },
      { key: "grade", label: t("grade"), value: (g) => g.gradeLabel, filterable: true },
      { key: "members", label: t("members"), type: "number", value: (g) => g.members.length },
      { key: "price", label: t("defaultPrice"), type: "number", value: (g) => g.defaultPricePerHour ?? 0 },
      {
        key: "status",
        label: tc("status"),
        type: "enum",
        value: (g) => (g.active ? "active" : "inactive"),
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
        <TableSearch value={search.query} onChange={search.setQuery} resultCount={search.filtered.length} placeholder={t("searchPlaceholder")} />
        <EntityDialog
          title={t("add")}
          action={saveGroup.bind(null, locale, null)}
          fields={<Fields teachers={teachers} subjects={subjects} levels={levels} />}
          trigger={<Button className="gap-2"><Plus className="size-4" />{t("add")}</Button>}
        />
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader><SortableTableHeader sf={sf} /></TableHeader>
          <TableBody>
            {pg.total === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">{tc("noData")}</TableCell></TableRow>
            )}
            {pg.pageItems.map((g) => (
              <TableRow key={g.id} className={g.active ? undefined : "opacity-60"}>
                <TableCell className="font-medium">
                  <Link href={`/groups/${g.id}`} className="hover:underline">{g.name}</Link>
                </TableCell>
                <TableCell>{g.teacherName ?? "—"}</TableCell>
                <TableCell>{g.subjectName ?? "—"}</TableCell>
                <TableCell>{g.gradeLabel ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={g.members.length ? "default" : "muted"}>{g.members.length}</Badge>
                </TableCell>
                <TableCell className="tabular-nums" dir="ltr">
                  {g.defaultPricePerHour != null ? `${formatMoney(g.defaultPricePerHour)} ${currency}` : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={g.active ? "success" : "muted"}>{g.active ? tc("active") : tc("inactive")}</Badge>
                </TableCell>
                <TableCell>
                  <RowActions>
                    <ViewDialog
                      title={g.name}
                      subtitle={g.teacherName}
                      fields={[
                        { label: t("teacher"), value: g.teacherName },
                        { label: t("subject"), value: g.subjectName },
                        { label: t("grade"), value: g.gradeLabel },
                        { label: t("location"), value: te(`location.${g.location}`) },
                        { label: t("defaultPrice"), value: g.defaultPricePerHour != null ? `${formatMoney(g.defaultPricePerHour)} ${currency}` : null, ltr: true },
                        { label: t("members"), value: g.members.length, ltr: true },
                        { label: tc("notes"), value: g.notes, wide: true },
                      ]}
                    />
                    <Button variant="ghost" size="icon" aria-label={t("manageMembers")} title={t("manageMembers")} onClick={() => setMembersFor(g)}>
                      <Users2 className="size-4" />
                    </Button>
                    <EntityDialog
                      title={t("edit")}
                      action={saveGroup.bind(null, locale, g.id)}
                      fields={<Fields group={g} teachers={teachers} subjects={subjects} levels={levels} />}
                      trigger={<Button variant="ghost" size="icon" aria-label={tc("edit")}><Pencil className="size-4" /></Button>}
                    />
                    <DeleteButton action={deleteGroup.bind(null, locale, g.id)} />
                  </RowActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination {...pg} />
      </div>

      {membersFor && (
        <MembersDialog
          group={groups.find((x) => x.id === membersFor.id) ?? membersFor}
          students={students}
          currency={currency}
          onClose={() => setMembersFor(null)}
        />
      )}
    </>
  );
}