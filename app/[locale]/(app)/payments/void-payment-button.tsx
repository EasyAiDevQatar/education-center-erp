"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Ban, Undo2 } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/crud/form-field";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cancelPayment, refundPayment } from "./refund-actions";

/**
 * Cancel or refund a receipt.
 *
 * Both ask for a reason and neither is optional about it: a voided receipt
 * with no explanation is an argument three months later, when the parent has
 * their copy and the centre has a gap.
 *
 * The two are genuinely different and the dialog says so rather than offering
 * one "void" that quietly means either. Cancel is for a receipt keyed in
 * error, where no money ever moved; refund is for money that arrived and went
 * back. The ledger treats them differently and so should the person choosing.
 */
export function VoidPaymentButton({
  paymentId,
  amount,
  currency,
  mode,
}: {
  paymentId: string;
  amount: number;
  currency: string;
  mode: "cancel" | "refund";
}) {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState(String(amount));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      const res =
        mode === "cancel"
          ? await cancelPayment(locale, { id: paymentId, reason })
          : await refundPayment(locale, {
              id: paymentId,
              reason,
              amount: Number(refund) || amount,
            });
      if (res.ok) {
        setOpen(false);
        setReason("");
        router.refresh();
      } else setError(res.error ?? "invalid");
    });

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t(mode === "cancel" ? "cancelReceipt" : "refundReceipt")}
        title={t(mode === "cancel" ? "cancelReceipt" : "refundReceipt")}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        {mode === "cancel" ? <Ban className="size-4" /> : <Undo2 className="size-4" />}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">
              {t(mode === "cancel" ? "cancelReceipt" : "refundReceipt")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {t(mode === "cancel" ? "cancelWarning" : "refundWarning")}
            </p>

            {mode === "refund" && (
              <FormField label={t("refundAmount")} htmlFor="refund-amount" hint={t("refundPartHint")}>
                <Input
                  id="refund-amount"
                  dir="ltr"
                  type="number"
                  step="0.01"
                  max={amount}
                  value={refund}
                  onChange={(e) => setRefund(e.target.value)}
                />
              </FormField>
            )}

            <FormField label={t("voidReason")} htmlFor="void-reason" hint={t("voidReasonHint")}>
              <Input
                id="void-reason"
                dir="auto"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </FormField>

            {error && (
              <p className="text-sm text-destructive">
                {t.has(`errors.${error}`) ? t(`errors.${error}`) : error}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {tc("cancel")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={pending || reason.trim().length < 3}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={submit}
            >
              {pending
                ? tc("saving")
                : mode === "cancel"
                  ? t("cancelReceipt")
                  : `${t("refundReceipt")} ${currency}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
