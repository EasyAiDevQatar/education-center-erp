"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, Printer } from "lucide-react";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { DeleteButton } from "@/components/crud/delete-button";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { TableSearch, useTableSearch } from "@/components/ui/table-search";
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
import { formatMoney } from "@/lib/money";
import { savePayment, deletePayment } from "./actions";
import { getStudentOutstanding, type OutstandingInfo } from "./balance-actions";

export type Opt = { id: string; label: string };
export type PaymentRow = {
  id: string;
  date: string;
  receiptNo: string;
  studentId: string | null;
  studentName: string;
  amount: number;
  method: string;
  teacherId: string | null;
  teacherName: string;
  notes: string | null;
};

/**
 * Payment form.
 *
 * Ordered student-first on purpose: the amount is meaningless until you know
 * who is paying, and once the student is chosen the outstanding balance is
 * fetched and pre-filled so the common case (settling up in full) is a single
 * confirmation rather than a lookup in another tab.
 */
function PaymentFields({
  payment,
  students,
  teachers,
  currency,
  defaultStudentId,
  defaultAmount,
}: {
  payment?: PaymentRow;
  students: Opt[];
  teachers: Opt[];
  currency: string;
  defaultStudentId?: string;
  defaultAmount?: number;
}) {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const today = new Date().toISOString().slice(0, 10);

  const [studentId, setStudentId] = useState(payment?.studentId ?? defaultStudentId ?? "");
  const [amount, setAmount] = useState(
    payment?.amount != null ? String(payment.amount) : defaultAmount != null ? String(defaultAmount) : "",
  );
  const [teacherId, setTeacherId] = useState(payment?.teacherId ?? "");
  const [info, setInfo] = useState<OutstandingInfo | null>(null);
  const [loading, setLoading] = useState(false);
  // Only auto-fill until the user types their own figure — a part payment must
  // never be silently overwritten by a later lookup.
  const [amountTouched, setAmountTouched] = useState(!!payment || defaultAmount != null);

  useEffect(() => {
    let cancelled = false;
    if (!studentId) {
      setInfo(null);
      return;
    }
    setLoading(true);
    getStudentOutstanding(studentId)
      .then((res) => {
        if (cancelled) return;
        setInfo(res);
        if (res && !amountTouched) setAmount(res.balance > 0 ? String(res.balance) : "");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  return (
    <>
      <FormField label={t("student")} htmlFor="studentId">
        <Combobox
          id="studentId"
          name="studentId"
          required
          options={students.map((s) => ({ value: s.id, label: s.label }))}
          value={studentId}
          onChange={setStudentId}
        />
      </FormField>

      {studentId && (
        <div className="rounded-md bg-accent/60 px-3 py-2 text-sm">
          {loading && <span className="text-muted-foreground">{tc("loading")}</span>}
          {!loading && info && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {t("outstanding")}:{" "}
                <span
                  className={
                    info.balance > 0
                      ? "font-semibold tabular-nums text-destructive"
                      : "font-semibold tabular-nums text-foreground"
                  }
                >
                  {formatMoney(info.balance)} {currency}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {t("unpaidSessionsCount", { n: info.unpaidSessions.length })}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <FormField label={tc("date")} htmlFor="date">
          <Input id="date" name="date" type="date" dir="ltr" defaultValue={payment?.date ?? today} required />
        </FormField>
        <FormField
          label={tc("amount")}
          htmlFor="amount"
          hint={info && info.balance > 0 && !payment ? t("amountPrefilledHint") : undefined}
        >
          <Input
            id="amount"
            name="amount"
            type="number"
            step="0.5"
            min="0"
            dir="ltr"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setAmountTouched(true);
            }}
            required
          />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("method")} htmlFor="method">
          <Select id="method" name="method" defaultValue={payment?.method ?? "CASH"}>
            <option value="CASH">{te("method.CASH")}</option>
            <option value="POS">{te("method.POS")}</option>
            <option value="QPAY">{te("method.QPAY")}</option>
            <option value="TRANSFER">{te("method.TRANSFER")}</option>
          </Select>
        </FormField>
        <FormField label={t("receiptNo")} htmlFor="receiptNo" hint={payment ? undefined : "auto"}>
          <Input id="receiptNo" name="receiptNo" dir="ltr" defaultValue={payment?.receiptNo ?? ""} placeholder="auto" disabled={!!payment} />
        </FormField>
      </div>

      <FormField label={t("allocateTeacher")} htmlFor="teacherId">
        <Combobox
          id="teacherId"
          name="teacherId"
          options={teachers.map((x) => ({ value: x.id, label: x.label }))}
          value={teacherId}
          onChange={setTeacherId}
        />
      </FormField>
      <FormField label={tc("notes")} htmlFor="notes">
        <Input id="notes" name="notes" defaultValue={payment?.notes ?? ""} />
      </FormField>
    </>
  );
}

export function PaymentsClient({
  payments,
  students,
  teachers,
  currency,
  locale: localeProp,
}: {
  payments: PaymentRow[];
  students: Opt[];
  teachers: Opt[];
  currency: string;
  locale: string;
}) {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const search = useTableSearch(payments, (p) => [
    p.studentName,
    p.receiptNo,
    p.teacherName,
    p.notes,
    p.date,
  ]);
  const pg = usePagination(search.filtered);

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
          action={savePayment.bind(null, locale, null)}
          fields={<PaymentFields students={students} teachers={teachers} currency={currency} />}
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
              <TableHead>{tc("date")}</TableHead>
              <TableHead>{t("receiptNo")}</TableHead>
              <TableHead>{t("student")}</TableHead>
              <TableHead className="text-end">{tc("amount")}</TableHead>
              <TableHead>{t("method")}</TableHead>
              <TableHead>{t("allocateTeacher")}</TableHead>
              <TableHead className="text-end">{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((p) => (
              <TableRow key={p.id}>
                <TableCell dir="ltr" className="text-start tabular-nums">{p.date}</TableCell>
                <TableCell dir="ltr" className="text-start tabular-nums">{p.receiptNo}</TableCell>
                <TableCell className="font-medium">{p.studentName}</TableCell>
                <TableCell className="text-end tabular-nums font-medium">{formatMoney(p.amount)} {currency}</TableCell>
                <TableCell><Badge variant="default">{te(`method.${p.method}`)}</Badge></TableCell>
                <TableCell>{p.teacherName}</TableCell>
                <TableCell className="text-end">
                  <div className="flex justify-end gap-1">
                    <a href={`/${localeProp}/receipt/${p.id}`} target="_blank" rel="noopener">
                      <Button variant="ghost" size="icon" aria-label={t("printReceipt")}>
                        <Printer className="size-4" />
                      </Button>
                    </a>
                    <EntityDialog
                      title={t("edit")}
                      action={savePayment.bind(null, locale, p.id)}
                      fields={<PaymentFields payment={p} students={students} teachers={teachers} currency={currency} />}
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    <DeleteButton action={deletePayment.bind(null, locale, p.id)} />
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
