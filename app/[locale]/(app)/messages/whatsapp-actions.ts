"use server";

import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES, FINANCE_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { formatMoney } from "@/lib/money";
import { getStudentBalance } from "@/lib/balances";
import { sendDirect } from "@/lib/integrations/notify";
import { remindOutstandingBalances, type ReminderRun } from "@/lib/dues-reminder";

export type SendState = { ok?: boolean; error?: string; run?: ReminderRun };

async function staff() {
  const s = await getSession();
  if (!s || !(STAFF_ROLES as readonly string[]).includes(s.role)) return { error: "forbidden" };
  return null;
}

/**
 * Send one family their statement summary.
 *
 * The figures rather than a link: the printable statement lives behind a
 * staff login, so a link would open a sign-in page for the one person it was
 * meant for. Charges, paid and balance are what they would read off it anyway.
 */
export async function sendStatement(locale: string, studentId: string): Promise<SendState> {
  const denied = await staff();
  if (denied) return denied;

  const student = await db.student.findUnique({
    where: { id: studentId },
    include: { guardian: { select: { phone: true } } },
  });
  if (!student) return { error: "notfound" };

  const [balance, t, centre, currencyRow] = await Promise.all([
    getStudentBalance(studentId),
    getTranslations({ locale, namespace: "messages" }),
    db.setting.findUnique({ where: { key: "centerName" } }),
    db.setting.findUnique({ where: { key: "currency" } }),
  ]);
  const currency = currencyRow?.value ?? "QAR";

  const text = t("statementMessage", {
    center: centre?.value ?? "",
    student: student.name,
    charges: formatMoney(balance.totalCharges),
    paid: formatMoney(balance.totalPaid),
    balance: formatMoney(balance.balance),
    currency,
  });

  const res = await sendDirect({
    to: student.guardian?.phone ?? student.phone,
    text,
    event: "STATEMENT",
    audience: student.guardian?.phone ? "PARENT" : "STUDENT",
    entity: { type: "Student", id: student.id },
  });
  if (res.ok) await writeAudit("Student", studentId, "UPDATE", { after: { statementSent: true } });
  return res.ok ? { ok: true } : { error: res.error ?? "failed" };
}

/**
 * Chase everybody who owes money, now rather than at 07:00.
 *
 * Finance-only: this reaches every family at once, and "who may send that" is
 * a different question from "who may look at the payments screen".
 */
export async function sendDuesReminders(locale: string): Promise<SendState> {
  const s = await getSession();
  if (!s || !(FINANCE_ROLES as readonly string[]).includes(s.role)) return { error: "forbidden" };
  void locale;

  const run = await remindOutstandingBalances();
  await writeAudit("Student", "bulk-dues-reminder", "UPDATE", { after: run });
  return { ok: true, run };
}
