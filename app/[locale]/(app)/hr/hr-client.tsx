"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, FileText, UserX, AlertTriangle, Trash2, HandCoins } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { FormField } from "@/components/crud/form-field";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
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
import { TableSearch, useTableSearch } from "@/components/ui/table-search";
import { TablePagination, usePagination } from "@/components/ui/table-pagination";
import { formatMoney } from "@/lib/money";
import {
  DEPARTMENTS,
  EMPLOYEE_STATUSES,
  CONTRACT_TYPES,
  EMPLOYEE_DOC_TYPES,
} from "@/lib/enums";
import { WPS_BANKS } from "@/lib/wps/banks";
import { displayName, nameSearchText } from "@/lib/names";
import { saveEmployee, terminateEmployee, saveDocument, deleteDocument } from "./actions";
import { createSettlement } from "./eos-actions";
import { computeGratuity, computeSettlement, dailyBasic } from "@/lib/gratuity";

export type DocRow = {
  id: string;
  type: string;
  number: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  notes: string | null;
};

export type EmployeeRow = {
  id: string;
  name: string;
  nameEn: string | null;
  employeeNo: string | null;
  phone: string | null;
  email: string | null;
  qid: string | null;
  visaId: string | null;
  passportNo: string | null;
  nationality: string | null;
  dob: string | null;
  hireDate: string | null;
  jobTitle: string | null;
  department: string | null;
  contractType: string | null;
  status: string;
  iban: string | null;
  bankShortName: string | null;
  basicSalary: number;
  allowances: number;
  teacherId: string | null;
  notes: string | null;
  documents: DocRow[];
};

export type ExpiryRow = {
  id: string;
  employeeName: string;
  type: string;
  number: string | null;
  expiresOn: string;
};

type TeacherOpt = { id: string; label: string; taken: boolean };

/** Days from today, negative when already past. */
function daysUntil(iso: string): number {
  const today = new Date().toISOString().slice(0, 10);
  return Math.round(
    (new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000,
  );
}

/* ---------------------------------------------------------------- fields */

function Section({ title }: { title: string }) {
  return (
    <p className="border-b border-border pb-1 pt-2 text-xs font-semibold text-muted-foreground">
      {title}
    </p>
  );
}

function EmployeeFields({
  employee,
  teachers,
}: {
  employee?: EmployeeRow;
  teachers: TeacherOpt[];
}) {
  const t = useTranslations("hr");
  const tc = useTranslations("common");
  const te = useTranslations("enums");

  // The linked teacher stays pickable when editing that record; every other
  // taken teacher is filtered out so two employees can't claim one teacher.
  const pickable = teachers.filter((x) => !x.taken || x.id === employee?.teacherId);

  return (
    <div className="max-h-[60vh] space-y-3 overflow-y-auto pe-1">
      <Section title={t("secIdentity")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={tc("nameAr")} htmlFor="e-name">
          <Input id="e-name" name="name" defaultValue={employee?.name} required />
        </FormField>
        <FormField label={tc("nameEn")} htmlFor="e-nameEn">
          <Input id="e-nameEn" name="nameEn" dir="ltr" defaultValue={employee?.nameEn ?? ""} />
        </FormField>
        <FormField label={t("employeeNo")} htmlFor="e-no">
          <Input id="e-no" name="employeeNo" dir="ltr" defaultValue={employee?.employeeNo ?? ""} />
        </FormField>
        <FormField label={t("nationality")} htmlFor="e-nat">
          <Input id="e-nat" name="nationality" defaultValue={employee?.nationality ?? ""} />
        </FormField>
        <FormField label={t("qid")} htmlFor="e-qid" hint={t("qidHint")}>
          <Input id="e-qid" name="qid" dir="ltr" inputMode="numeric" defaultValue={employee?.qid ?? ""} />
        </FormField>
        <FormField label={t("visaId")} htmlFor="e-visa" hint={t("visaHint")}>
          <Input id="e-visa" name="visaId" dir="ltr" defaultValue={employee?.visaId ?? ""} />
        </FormField>
        <FormField label={t("passportNo")} htmlFor="e-pass">
          <Input id="e-pass" name="passportNo" dir="ltr" defaultValue={employee?.passportNo ?? ""} />
        </FormField>
        <FormField label={t("dob")} htmlFor="e-dob">
          <Input id="e-dob" name="dob" type="date" dir="ltr" defaultValue={employee?.dob ?? ""} />
        </FormField>
      </div>

      <Section title={t("secEmployment")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("hireDate")} htmlFor="e-hire">
          <Input id="e-hire" name="hireDate" type="date" dir="ltr" defaultValue={employee?.hireDate ?? ""} />
        </FormField>
        <FormField label={t("jobTitle")} htmlFor="e-job">
          <Input id="e-job" name="jobTitle" defaultValue={employee?.jobTitle ?? ""} />
        </FormField>
        <FormField label={t("department")} htmlFor="e-dept">
          <Select id="e-dept" name="department" defaultValue={employee?.department ?? ""}>
            <option value="">—</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>{te(`department.${d}`)}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("contractType")} htmlFor="e-contract">
          <Select id="e-contract" name="contractType" defaultValue={employee?.contractType ?? ""}>
            <option value="">—</option>
            {CONTRACT_TYPES.map((c) => (
              <option key={c} value={c}>{te(`contractType.${c}`)}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={tc("status")} htmlFor="e-status">
          <Select id="e-status" name="status" defaultValue={employee?.status ?? "ACTIVE"}>
            {EMPLOYEE_STATUSES.map((x) => (
              <option key={x} value={x}>{te(`employeeStatus.${x}`)}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("linkedTeacher")} htmlFor="e-teacher" hint={t("linkedTeacherHint")}>
          <Select id="e-teacher" name="teacherId" defaultValue={employee?.teacherId ?? ""}>
            <option value="">—</option>
            {pickable.map((x) => (
              <option key={x.id} value={x.id}>{x.label}</option>
            ))}
          </Select>
        </FormField>
      </div>

      <Section title={t("secPay")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("basicSalary")} htmlFor="e-basic" hint={t("basicSalaryHint")}>
          <Input id="e-basic" name="basicSalary" type="number" step="0.01" min="0" dir="ltr" defaultValue={employee?.basicSalary ?? 0} />
        </FormField>
        <FormField label={t("allowances")} htmlFor="e-allow">
          <Input id="e-allow" name="allowances" type="number" step="0.01" min="0" dir="ltr" defaultValue={employee?.allowances ?? 0} />
        </FormField>
        <FormField label={t("bank")} htmlFor="e-bank">
          <Select id="e-bank" name="bankShortName" defaultValue={employee?.bankShortName ?? ""}>
            <option value="">—</option>
            {WPS_BANKS.map((b) => (
              <option key={b.code} value={b.code}>{b.code} — {b.nameEn}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("iban")} htmlFor="e-iban" hint={t("ibanHint")}>
          <Input id="e-iban" name="iban" dir="ltr" placeholder="QA…" defaultValue={employee?.iban ?? ""} />
        </FormField>
      </div>

      <Section title={t("secContact")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={tc("phone")} htmlFor="e-phone">
          <Input id="e-phone" name="phone" dir="ltr" defaultValue={employee?.phone ?? ""} />
        </FormField>
        <FormField label={tc("email")} htmlFor="e-email">
          <Input id="e-email" name="email" type="email" dir="ltr" defaultValue={employee?.email ?? ""} />
        </FormField>
      </div>
      <FormField label={tc("notes")} htmlFor="e-notes">
        <Input id="e-notes" name="notes" defaultValue={employee?.notes ?? ""} />
      </FormField>
    </div>
  );
}

/* ------------------------------------------------------------- documents */

function DocumentsDialog({
  employee,
  onClose,
}: {
  employee: EmployeeRow;
  onClose: () => void;
}) {
  const t = useTranslations("hr");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;
    setError(null);
    start(async () => {
      const res = await saveDocument(locale, {}, fd);
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
          <DialogTitle>
            {t("documentsFor", { name: employee.name })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {employee.documents.length === 0 ? (
            <p className="py-3 text-center text-sm text-muted-foreground">{tc("noData")}</p>
          ) : (
            <div className="space-y-1">
              {employee.documents.map((d) => {
                const days = d.expiresOn ? daysUntil(d.expiresOn) : null;
                return (
                  <div
                    key={d.id}
                    className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm"
                  >
                    <span className="font-medium">{te(`docType.${d.type}`)}</span>
                    {d.number && (
                      <span className="text-muted-foreground tabular-nums" dir="ltr">{d.number}</span>
                    )}
                    <span className="ms-auto flex shrink-0 items-center gap-2">
                      {d.expiresOn && (
                        <Badge
                          variant={days !== null && days <= 14 ? "destructive" : days !== null && days <= 60 ? "warning" : "default"}
                        >
                          {d.expiresOn}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={tc("delete")}
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            await deleteDocument(locale, d.id);
                            router.refresh();
                          })
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* A renewal is a NEW row — history of what was valid when survives. */}
          <form onSubmit={onSubmit} className="space-y-3 rounded-md border border-border p-3">
            <input type="hidden" name="employeeId" value={employee.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t("docType")} htmlFor="d-type">
                <Select id="d-type" name="type" defaultValue="QID">
                  {EMPLOYEE_DOC_TYPES.map((x) => (
                    <option key={x} value={x}>{te(`docType.${x}`)}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t("docNumber")} htmlFor="d-number">
                <Input id="d-number" name="number" dir="ltr" />
              </FormField>
              <FormField label={t("issuedOn")} htmlFor="d-issued">
                <Input id="d-issued" name="issuedOn" type="date" dir="ltr" />
              </FormField>
              <FormField label={t("expiresOn")} htmlFor="d-expires">
                <Input id="d-expires" name="expiresOn" type="date" dir="ltr" />
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
            <Button type="button" variant="outline">{tc("close")}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------- end of service */

function EosFields({ employee }: { employee: EmployeeRow }) {
  const t = useTranslations("eos");
  const tc = useTranslations("common");
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [unusedLeave, setUnusedLeave] = useState(0);
  const [otherDues, setOtherDues] = useState(0);
  const [deductions, setDeductions] = useState(0);

  // Live preview with the SAME pure functions the server uses. The one thing
  // the client cannot know is total unpaid leave — the server subtracts it,
  // so the preview is labelled as before-unpaid-leave.
  const g = employee.hireDate
    ? computeGratuity({
        hireDate: employee.hireDate,
        endDate: day,
        basicSalary: employee.basicSalary,
      })
    : null;
  const st =
    g &&
    computeSettlement({
      gratuityAmount: g.amount,
      unusedLeaveDays: unusedLeave,
      dailyBasic: dailyBasic(employee.basicSalary),
      otherDues,
      deductions,
    });

  return (
    <>
      <input type="hidden" name="employeeId" value={employee.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t("lastWorkingDay")} htmlFor="eos-day">
          <Input
            id="eos-day"
            name="lastWorkingDay"
            type="date"
            dir="ltr"
            required
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </FormField>
        <FormField label={t("unusedLeave")} htmlFor="eos-leave" hint={t("unusedLeaveHint")}>
          <Input
            id="eos-leave"
            name="unusedLeaveDays"
            type="number"
            step="0.5"
            min="0"
            dir="ltr"
            value={unusedLeave}
            onChange={(e) => setUnusedLeave(Math.max(0, Number(e.target.value) || 0))}
          />
        </FormField>
        <FormField label={t("otherDues")} htmlFor="eos-dues">
          <Input
            id="eos-dues"
            name="otherDues"
            type="number"
            step="0.01"
            min="0"
            dir="ltr"
            value={otherDues}
            onChange={(e) => setOtherDues(Math.max(0, Number(e.target.value) || 0))}
          />
        </FormField>
        <FormField label={t("deductions")} htmlFor="eos-ded">
          <Input
            id="eos-ded"
            name="deductions"
            type="number"
            step="0.01"
            min="0"
            dir="ltr"
            value={deductions}
            onChange={(e) => setDeductions(Math.max(0, Number(e.target.value) || 0))}
          />
        </FormField>
      </div>

      {!employee.hireDate ? (
        <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
          {t("needsHireDate")}
        </p>
      ) : (
        g &&
        st && (
          <div className="space-y-1 rounded-md border border-border p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("service")}</span>
              <span className="tabular-nums">{t("serviceValue", { years: g.serviceYears, days: g.serviceDays })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("gratuity")}</span>
              <span className="tabular-nums">
                {g.eligible ? formatMoney(g.amount) : t("underOneYear")}
              </span>
            </div>
            {unusedLeave > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("leaveEncashment")}</span>
                <span className="tabular-nums">{formatMoney(st.leaveEncashment)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-1 font-semibold">
              <span>{t("netSettlement")}</span>
              <span className={st.net < 0 ? "tabular-nums text-destructive" : "tabular-nums"}>
                {formatMoney(st.net)}
              </span>
            </div>
            <p className="pt-1 text-xs text-muted-foreground">{t("unpaidNote")}</p>
          </div>
        )
      )}

      <FormField label={tc("notes")} htmlFor="eos-notes">
        <Input id="eos-notes" name="notes" />
      </FormField>
      <p className="text-xs text-warning">{t("terminatesWarning")}</p>
    </>
  );
}

/* -------------------------------------------------------------- terminate */

function TerminateDialog({
  employee,
  onClose,
}: {
  employee: EmployeeRow;
  onClose: () => void;
}) {
  const t = useTranslations("hr");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [pending, start] = useTransition();

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("terminateTitle", { name: employee.name })}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("terminateHint")}</p>
        <FormField label={t("lastWorkingDay")} htmlFor="t-day">
          <Input id="t-day" type="date" dir="ltr" value={day} onChange={(e) => setDay(e.target.value)} />
        </FormField>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">{tc("cancel")}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={pending || !day}
            onClick={() =>
              start(async () => {
                const r = await terminateEmployee(locale, employee.id, day);
                if (r.ok) {
                  onClose();
                  router.refresh();
                }
              })
            }
          >
            {t("terminateAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ main */

export function HrClient({
  employees,
  teachers,
  alerts,
}: {
  employees: EmployeeRow[];
  teachers: TeacherOpt[];
  alerts: ExpiryRow[];
}) {
  const t = useTranslations("hr");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const tEos = useTranslations("eos");
  const locale = useLocale();

  const [docsFor, setDocsFor] = useState<EmployeeRow | null>(null);
  const [terminating, setTerminating] = useState<EmployeeRow | null>(null);

  const search = useTableSearch(employees, (e) => [
    nameSearchText(e),
    e.employeeNo,
    e.jobTitle,
    e.phone,
    e.qid,
  ]);
  const pg = usePagination(search.filtered);

  return (
    <div className="space-y-4">
      {/* Expiry alerts — the reason the register earns its keep day to day. */}
      {alerts.length > 0 && (
        <div className="rounded-lg border border-warning/50 bg-warning/5 p-3">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="size-4 text-warning" />
            {t("expiryAlerts", { n: alerts.length })}
          </p>
          <div className="flex flex-wrap gap-2">
            {alerts.map((a) => {
              const days = daysUntil(a.expiresOn);
              return (
                <Badge key={a.id} variant={days <= 14 ? "destructive" : "warning"}>
                  {a.employeeName} · {te(`docType.${a.type}`)} ·{" "}
                  {days < 0 ? t("expiredAgo", { n: -days }) : t("expiresIn", { n: days })}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <TableSearch
          value={search.query}
          onChange={search.setQuery}
          resultCount={search.isFiltering ? search.filtered.length : undefined}
        />
        <EntityDialog
          title={t("addEmployee")}
          action={saveEmployee.bind(null, locale, null)}
          fields={<EmployeeFields teachers={teachers} />}
          trigger={
            <Button className="gap-1">
              <Plus className="size-4" />
              {t("addEmployee")}
            </Button>
          }
        />
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tc("name")}</TableHead>
              <TableHead>{t("jobTitle")}</TableHead>
              <TableHead>{t("department")}</TableHead>
              <TableHead>{t("hireDate")}</TableHead>
              <TableHead className="text-end">{t("basicSalary")}</TableHead>
              <TableHead>{tc("status")}</TableHead>
              <TableHead className="text-end">{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pg.pageItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((e) => {
              const expiringDocs = e.documents.filter(
                (d) => d.expiresOn && daysUntil(d.expiresOn) <= 60,
              ).length;
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">
                    {displayName(e, locale)}
                    {e.employeeNo && (
                      <span className="ms-1 text-xs text-muted-foreground tabular-nums" dir="ltr">
                        #{e.employeeNo}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{e.jobTitle ?? "—"}</TableCell>
                  <TableCell>{e.department ? te(`department.${e.department}`) : "—"}</TableCell>
                  <TableCell className="tabular-nums" dir="ltr">{e.hireDate ?? "—"}</TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatMoney(e.basicSalary + e.allowances)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        e.status === "ACTIVE" ? "success" : e.status === "ON_LEAVE" ? "warning" : "default"
                      }
                    >
                      {te(`employeeStatus.${e.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("documents")}
                        title={t("documents")}
                        className="relative"
                        onClick={() => setDocsFor(e)}
                      >
                        <FileText className="size-4" />
                        {expiringDocs > 0 && (
                          <span className="absolute -end-0.5 -top-0.5 size-2 rounded-full bg-destructive" />
                        )}
                      </Button>
                      <EntityDialog
                        title={tc("edit")}
                        action={saveEmployee.bind(null, locale, e.id)}
                        fields={<EmployeeFields employee={e} teachers={teachers} />}
                        trigger={
                          <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                            <Pencil className="size-4" />
                          </Button>
                        }
                      />
                      {e.status !== "TERMINATED" && (
                        <EntityDialog
                          title={tEos("title", { name: e.name })}
                          action={createSettlement.bind(null, locale)}
                          fields={<EosFields employee={e} />}
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={tEos("action")}
                              title={tEos("action")}
                            >
                              <HandCoins className="size-4" />
                            </Button>
                          }
                        />
                      )}
                      {e.status !== "TERMINATED" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("terminateAction")}
                          title={t("terminateAction")}
                          onClick={() => setTerminating(e)}
                        >
                          <UserX className="size-4" />
                        </Button>
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
          // Re-read the row each render so a just-added document appears.
          employee={employees.find((x) => x.id === docsFor.id) ?? docsFor}
          onClose={() => setDocsFor(null)}
        />
      )}
      {terminating && (
        <TerminateDialog employee={terminating} onClose={() => setTerminating(null)} />
      )}
    </div>
  );
}
