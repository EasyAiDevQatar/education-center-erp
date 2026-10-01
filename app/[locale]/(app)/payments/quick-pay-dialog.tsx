"use client";

import { useRef, useState } from "react";
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
import { localToday } from "@/lib/session-time";
import { showPaymentReceipt } from "@/lib/payment-receipt";
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
  initiallyOpen = false,
  sessionId,
  sessionIds,
  onClose,
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
  initiallyOpen?: boolean;
  sessionId?: string;
  sessionIds?: string[];
  onClose?: () => void;
}) {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();

  const [open, setOpen] = useState(initiallyOpen);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Controlled so the allocator can re-suggest as the figure is edited.
  const [payAmount, setPayAmount] = useState<string>(amount > 0 ? String(amount) : "");
  // Follows the allocation until the desk picks a teacher by hand.
  const [teacherSel, setTeacherSel] = useState("");
  const teacherManual = useRef(false);

  const today = localToday();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    if (sessionIds) {
      const lines = JSON.parse(String(fd.get("allocations") || "[]")) as { sessionId: string; amount: number }[];
      const allocated = lines.reduce((sum, line) => sum + line.amount, 0);
      if (!lines.length || lines.some((line) => !sessionIds.includes(line.sessionId)) || Math.abs(allocated - Number(fd.get("amount"))) > 0.005) {
        setError("allocation");
        return;
      }
    }
    setPending(true);
    // Reserve the print tab during the click, before the asynchronous save.
    const receiptWindow = window.open("about:blank", "_blank");
    if (receiptWindow) receiptWindow.opener = null;
    try {
      const res = await savePayment(locale, null, {}, fd);
      if (res.ok) {
        setOpen(false);
        onPaid?.();
        router.refresh();
        showPaymentReceipt(receiptWindow, locale, res.receiptId, (path) => router.push(path));
      } else {
        receiptWindow?.close();
        setError(res.error ?? "invalid");
      }
    } catch {
      receiptWindow?.close();
      setError("invalid");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {initiallyOpen ? null : variant === "icon" ? (
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

      <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) onClose?.(); }}>
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
                  max={sessionId || sessionIds ? amount : undefined}
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
              <FormField label={t("allocateTeacher")} htmlFor="qp-teacher" hint={t("manualTeacherHint")}>
                <Select
                  id="qp-teacher"
                  name="teacherId"
                  value={teacherSel}
                  onChange={(e) => {
                    teacherManual.current = true;
                    setTeacherSel(e.target.value);
                  }}
                >
                  <option value="">—</option>
                  {teachers.map((x) => (
                    <option key={x.id} value={x.id}>{x.label}</option>
                  ))}
                </Select>
              </FormField>
            </div>

            {sessionId ? (
              <input type="hidden" name="allocations" value={JSON.stringify([
                { sessionId, amount: Number(payAmount) || 0 },
              ])} />
            ) : <PaymentAllocator
              sessionIds={sessionIds}
              studentId={studentId}
              amount={parseFloat(payAmount) || 0}
              currency={currency}
              open={open}
              onExplicitTotal={(total) => {
                if (total > 0) setPayAmount(String(total));
              }}
              onTeacherInferred={(tid) => {
                if (!teacherManual.current) setTeacherSel(tid ?? "");
              }}
            />}

            <FormField label={tc("notes")} htmlFor="qp-notes">
              <Input id="qp-notes" name="notes" />
            </FormField>

            {error && <p className="text-sm text-destructive">{error === "allocation" ? t("selectSessionAllocation") : tc("errorGeneric")}</p>}

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
