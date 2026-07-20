"use client";

import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, Printer } from "lucide-react";
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
import { formatMoney } from "@/lib/money";
import { savePayment, deletePayment } from "./actions";

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

function PaymentFields({
  payment,
  students,
  teachers,
}: {
  payment?: PaymentRow;
  students: Opt[];
  teachers: Opt[];
}) {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={tc("date")} htmlFor="date">
          <Input id="date" name="date" type="date" dir="ltr" defaultValue={payment?.date ?? today} required />
        </FormField>
        <FormField label={tc("amount")} htmlFor="amount">
          <Input id="amount" name="amount" type="number" step="0.5" min="0" dir="ltr" defaultValue={payment?.amount ?? ""} required />
        </FormField>
      </div>
      <FormField label={t("student")} htmlFor="studentId">
        <Select id="studentId" name="studentId" defaultValue={payment?.studentId ?? ""} required>
          <option value="">—</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </Select>
      </FormField>
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
        <Select id="teacherId" name="teacherId" defaultValue={payment?.teacherId ?? ""}>
          <option value="">—</option>
          {teachers.map((tt) => (
            <option key={tt.id} value={tt.id}>{tt.label}</option>
          ))}
        </Select>
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
  const pg = usePagination(payments);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <EntityDialog
          title={t("add")}
          action={savePayment.bind(null, locale, null)}
          fields={<PaymentFields students={students} teachers={teachers} />}
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
                      fields={<PaymentFields payment={p} students={students} teachers={teachers} />}
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
