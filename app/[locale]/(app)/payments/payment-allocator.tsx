"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Wand2, TriangleAlert, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import {
  byTeacher,
  inferTeacher,
  suggestAllocation,
  validateAllocation,
  type PayableSession,
} from "@/lib/allocation";
import { loadOutstandingSessions } from "./allocation-actions";

/**
 * Choose which lessons a payment settles.
 *
 * Recording a payment used to leave it floating against the balance: the money
 * was on the books but no lesson was marked paid, so "who is this for" had to
 * be reconstructed by hand. This proposes the split — oldest debt first — and
 * lets the desk override any line before saving.
 */
export function PaymentAllocator({
  studentId,
  amount,
  currency,
  open,
  onExplicitTotal,
  onTeacherInferred,
}: {
  studentId: string;
  amount: number;
  currency: string;
  /** Reload when the dialog opens; outstanding moves as other staff collect. */
  open: boolean;
  /** Fires when the desk picks sessions by checkbox: the sum of all lines. */
  onExplicitTotal?: (total: number) => void;
  /** One teacher owns every allocated line → their id; mixed/none → null. */
  onTeacherInferred?: (teacherId: string | null) => void;
}) {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const locale = useLocale();

  const [sessions, setSessions] = useState<PayableSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  /** Sessions the desk explicitly ticked "pay this" on. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** Once the desk edits a line, stop overwriting their work on every keystroke. */
  const touched = useRef(false);

  useEffect(() => {
    if (!open || !studentId) return;
    let cancelled = false;
    setLoading(true);
    touched.current = false;
    loadOutstandingSessions(locale, studentId)
      .then((r) => {
        if (cancelled) return;
        setSessions(r.sessions);
        setPicked(new Set());
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, studentId, locale]);

  const applySuggestion = useCallback(
    (value: number) => {
      const s = suggestAllocation(sessions, value);
      const next: Record<string, string> = {};
      for (const l of s.lines) next[l.sessionId] = String(l.amount);
      setAmounts(next);
    },
    [sessions],
  );

  // Re-suggest as the amount changes, until the desk takes over.
  useEffect(() => {
    if (touched.current || sessions.length === 0) return;
    applySuggestion(amount);
  }, [amount, sessions, applySuggestion]);

  /**
   * Tick = "settle THIS lesson": the full outstanding lands on the ticked
   * session and the payment amount follows the sum — an explicit choice that
   * beats the oldest-first suggestion, old debt or not.
   */
  const togglePick = (sess: PayableSession, on: boolean) => {
    touched.current = true;
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(sess.id);
      else next.delete(sess.id);
      return next;
    });
    const nextAmounts = { ...amounts, [sess.id]: on ? String(sess.outstanding) : "" };
    setAmounts(nextAmounts);
    const total =
      Math.round(
        Object.values(nextAmounts).reduce((a, v) => a + (parseFloat(v) || 0), 0) * 100,
      ) / 100;
    onExplicitTotal?.(total);
  };

  const lines = useMemo(
    () =>
      Object.entries(amounts)
        .map(([sessionId, v]) => ({
          sessionId,
          amount: Math.round((parseFloat(v) || 0) * 100) / 100,
          partial: false,
        }))
        .filter((l) => l.amount > 0.005),
    [amounts],
  );

  const allocated = useMemo(
    () => Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100,
    [lines],
  );
  const totalOutstanding = useMemo(
    () => Math.round(sessions.reduce((a, s) => a + s.outstanding, 0) * 100) / 100,
    [sessions],
  );
  const check = useMemo(
    () => validateAllocation(sessions, lines, amount),
    [sessions, lines, amount],
  );
  const teachers = useMemo(() => byTeacher(sessions, lines), [sessions, lines]);
  const inferredTeacher = useMemo(() => inferTeacher(sessions, lines), [sessions, lines]);
  useEffect(() => {
    onTeacherInferred?.(inferredTeacher);
    // The callback identity changes per render; the inferred value is the signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inferredTeacher]);
  const unallocated = Math.round((amount - allocated) * 100) / 100;

  if (!studentId) return null;

  return (
    <div className="rounded-md border border-border">
      {/* The split is posted as one field; savePayment re-validates it. */}
      <input type="hidden" name="allocations" value={JSON.stringify(lines)} />

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-medium">{t("allocateTitle")}</span>
        {totalOutstanding > 0 && (
          <Badge variant="muted">
            <span dir="ltr">
              {t("outstandingTotal")}: {formatMoney(totalOutstanding)} {currency}
            </span>
          </Badge>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ms-auto gap-1"
          disabled={loading || sessions.length === 0}
          onClick={() => {
            touched.current = false;
            setPicked(new Set());
            applySuggestion(amount);
          }}
        >
          <Wand2 className="size-3.5" />
          {t("autoAllocate")}
        </Button>
      </div>

      {loading ? (
        <p className="p-3 text-center text-sm text-muted-foreground">{tc("loading")}</p>
      ) : sessions.length === 0 ? (
        <p className="p-3 text-center text-sm text-muted-foreground">{t("nothingOutstanding")}</p>
      ) : (
        <>
          <ul className="max-h-56 divide-y divide-border overflow-y-auto">
            {sessions.map((s, i) => {
              const value = amounts[s.id] ?? "";
              const num = parseFloat(value) || 0;
              const over = num > s.outstanding + 0.005;
              const partly = num > 0.005 && num + 0.005 < s.outstanding;
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    checked={picked.has(s.id)}
                    onChange={(e) => togglePick(s, e.target.checked)}
                    aria-label={`${t("payThis")} ${s.date}`}
                    title={t("payThis")}
                  />
                  {/* Oldest first, numbered, so "clear the old ones" is visible
                      rather than something the reader has to work out. */}
                  <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs tabular-nums">
                    {i + 1}
                  </span>
                  <span className="tabular-nums" dir="ltr">
                    {s.date}
                  </span>
                  <span className="text-muted-foreground">{s.teacherName || "—"}</span>
                  <span className="ms-auto text-xs text-muted-foreground" dir="ltr">
                    {t("owes")} {formatMoney(s.outstanding)}
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max={s.outstanding}
                    dir="ltr"
                    aria-label={`${t("allocate")} ${s.date}`}
                    className={`h-8 w-24 ${over ? "border-destructive" : ""}`}
                    value={value}
                    onChange={(e) => {
                      touched.current = true;
                      setAmounts((prev) => ({ ...prev, [s.id]: e.target.value }));
                      if (!e.target.value) {
                        setPicked((prev) => {
                          const next = new Set(prev);
                          next.delete(s.id);
                          return next;
                        });
                      }
                    }}
                  />
                  {partly && <Badge variant="warning">{t("partial")}</Badge>}
                </li>
              );
            })}
          </ul>

          {/* Per teacher, because payouts are per teacher — the session list
              alone does not answer "who did this money settle for". */}
          {teachers.length > 1 && (
            <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2">
              {teachers.map((x) => (
                <Badge key={x.teacherId ?? "none"} variant={x.allocated > 0 ? "success" : "muted"}>
                  {x.teacherName || "—"}
                  <span dir="ltr"> · {formatMoney(x.allocated)}/{formatMoney(x.outstanding)}</span>
                </Badge>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-sm">
            <span dir="ltr">
              {t("allocated")}: <strong>{formatMoney(allocated)}</strong> / {formatMoney(amount)}{" "}
              {currency}
            </span>
            {unallocated > 0.005 && (
              <span className="text-muted-foreground" dir="ltr">
                {t("unallocated")}: {formatMoney(unallocated)}
              </span>
            )}
            {totalOutstanding - allocated > 0.005 && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Clock className="size-3.5" />
                <span dir="ltr">
                  {t("stillOwing")}: {formatMoney(Math.round((totalOutstanding - allocated) * 100) / 100)}
                </span>
              </span>
            )}
          </div>

          {!check.ok && (
            <p className="flex items-center gap-1.5 border-t border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <TriangleAlert className="size-4" />
              {check.error === "overSession" ? t("errorOverSession") : t("errorOverPayment")}
            </p>
          )}
        </>
      )}
    </div>
  );
}