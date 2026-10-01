"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QuickPayDialog } from "@/app/[locale]/(app)/payments/quick-pay-dialog";
import { loadOutstandingSessions } from "@/app/[locale]/(app)/payments/allocation-actions";
import type { SessionLine } from "./relation-tables";
import { profilePayableSessions } from "@/lib/profile-payment";

/** Each student gets their own receipt; a teacher profile never pays another teacher's lessons. */
export function PayProfileSessions({ rows, currency }: { rows: SessionLine[]; currency: string }) {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [payment, setPayment] = useState<{ studentId: string; studentName: string; amount: number; sessionIds: string[]; teachers: { id: string; label: string }[] } | null>(null);
  const students = [...new Map(rows.map((r) => [r.studentId, r.studentName])).entries()];

  async function choose(studentId: string, studentName: string) {
    setPending(true);
    setError("");
    try {
      const result = await loadOutstandingSessions(locale, studentId);
      const sessions = profilePayableSessions(result.sessions, rows, studentId);
      if (!sessions.length) { setError(t("nothingOutstanding")); return; }
      setPayment({ studentId, studentName,
        amount: Math.round(sessions.reduce((sum, s) => sum + s.outstanding, 0) * 100) / 100,
        sessionIds: sessions.map((s) => s.id),
        teachers: [...new Map(sessions.filter((s) => s.teacherId).map((s) => [s.teacherId!, { id: s.teacherId!, label: s.teacherName }])).values()],
      });
      setOpen(false);
    } catch { setError(tc("errorGeneric")); }
    finally { setPending(false); }
  }

  return <>
    <Button size="sm" className="gap-2" disabled={!rows.length} onClick={() => { setError(""); setOpen(true); }}>
      <Banknote className="size-4" />{t("paySessions")}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("paySessions")}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{t("profilePaymentHint")}</p>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {students.map(([id, name]) => <Button key={id} variant="outline" className="w-full justify-start" disabled={pending} onClick={() => void choose(id, name)}>{name}</Button>)}
        </div>
        {pending && <p role="status">{tc("loading")}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
    {payment && <QuickPayDialog key={payment.studentId} {...payment} currency={currency} initiallyOpen onClose={() => setPayment(null)} onPaid={() => setPayment(null)} />}
  </>;
}
