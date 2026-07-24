"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Banknote } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatMoney } from "@/lib/money";
import { localNowTime, localToday } from "@/lib/session-time";
import { savePayment } from "./actions";
import { PaymentAllocator } from "./payment-allocator";

/**
 * "Pay now" — record a payment for a known student without leaving the page.
 *
 * The student is fixed (it comes from the row you clicked), so unlike the full
 * payment dialog there is nothing to search for; the amount is pre-filled with
 * what this action is settling and stays editable for part payments.
 */
export function QuickPayDialog({
  studentId,
  studentName,
  amount,
  currency,
  teachers = [],
  label,
  variant = "icon",
  disabled,
  onPaid,
}: {
  studentId: string;
  studentName: string;
  amount: number;
  currency: string;
  teachers?: { id: string; label: string }[];
  label?: string;
  variant?: "icon" | "button";
  disabled?: boolean;
  onPaid?: () => void;
}) {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Controlled so the allocator can re-suggest as the figure is edited.
  const [payAmount, setPayAmount] = useState<string>(amount > 0 ? String(amount) : "");

  const today = localToday();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    setPending(true);
    try {
      const res = await savePayment(locale, null, {}, fd);
      if (res.ok) {
        setOpen(false);
        onPaid?.();
        router.refresh();
      } else setError(res.error ?? "invalid");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {variant === "icon" ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={label ?? t("payNow")}
          title={label ?? t("payNow")}
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <Banknote className="size-4" />
        </Button>
      ) : (
        <Button size="sm" className="gap-1" disabled={disabled} onClick={() => setOpen(true)}>
          <Banknote className="size-4" />
          {label ?? t("payNow")}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("payNowFor", { name: studentName })}</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            {/* The student is decided by the row, so it posts hidden. */}
            <input type="hidden" name="studentId" value={studentId} />

            <div className="rounded-md bg-accent/60 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t("amountDue")}: </span>
              <span className="font-semibold tabular-nums">
                {formatMoney(amount)} {currency}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label={tc("date")} htmlFor="qp-date">
                <Input id="qp-date" name="date" type="date" dir="ltr" defaultValue={today} required />
              </FormField>
              <FormField label={tc("amount")} htmlFor="qp-amount">
                <Input
                  id="qp-amount"
                  name="amount"
                  type="number"
                  step="0.5"
                  min="0"
                  dir="ltr"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  required
                />
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label={t("method")} htmlFor="qp-method">
                <Select id="qp-method" name="method" defaultValue="CASH">
                  <option value="CASH">{te("method.CASH")}</option>
                  <option value="POS">{te("method.POS")}</option>
                  <option value="QPAY">{te("method.QPAY")}</option>
                  <option value="TRANSFER">{te("method.TRANSFER")}</option>
                </Select>
              </FormField>
              <FormField label={t("allocateTeacher")} htmlFor="qp-teacher">
                <Select id="qp-teacher" name="teacherId" defaultValue="">
                  <option value="">—</option>
                  {teachers.map((x) => (
                    <option key={x.id} value={x.id}>{x.label}</option>
                  ))}
                </Select>
              </FormField>
            </div>

            <PaymentAllocator
              studentId={studentId}
              amount={parseFloat(payAmount) || 0}
              currency={currency}
              open={open}
            />

            <FormField label={tc("notes")} htmlFor="qp-notes">
              <Input id="qp-notes" name="notes" />
            </FormField>

            {error && <p className="text-sm text-destructive">{tc("errorGeneric")}</p>}

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">{tc("cancel")}</Button>
              </DialogClose>
              <Button type="submit" disabled={pending}>
                {pending ? tc("saving") : t("recordPayment")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
