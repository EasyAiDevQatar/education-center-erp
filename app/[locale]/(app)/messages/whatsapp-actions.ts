"use server";

import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES, FINANCE_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { formatMoney } from "@/lib/money";
import { getStudentBalance } from "@/lib/balances";
import { getTeacherEarnings } from "@/lib/payroll";
import { sendDirect } from "@/lib/integrations/notify";
import { signStatementToken, type StatementKind } from "@/lib/statement-token";
import { remindOutstandingBalances, type ReminderRun } from "@/lib/dues-reminder";

export type SendState = { ok?: boolean; error?: string; run?: ReminderRun };

async function staff() {
  const s = await getSession();
  if (!s || !(STAFF_ROLES as readonly string[]).includes(s.role)) return { error: "forbidden" };
  return null;
}

/** The origin this instance is reachable on — staging shows its own, not production's. */
async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

/**
 * Who to send a given statement to, and what to say about it.
 *
 * Kept together because the three kinds differ in every particular: a student's
 * statement goes to the parent, a family's goes to the parent directly, and a
 * teacher's goes to the teacher and says what they are owed rather than what
 * they owe.
 */
async function recipientFor(kind: StatementKind, id: string, locale: string) {
  const t = await getTranslations({ locale, namespace: "messages" });
  const [centre, currencyRow] = await Promise.all([
    db.setting.findUnique({ where: { key: "centerName" } }),
    db.setting.findUnique({ where: { key: "currency" } }),
  ]);
  const center = centre?.value ?? "";
  const currency = currencyRow?.value ?? "QAR";

  if (kind === "student") {
    const student = await db.student.findUnique({
      where: { id },
      include: { guardian: { select: { phone: true } } },
    });
    if (!student) return null;
    const b = await getStudentBalance(id);
    return {
      to: student.guardian?.phone ?? student.phone,
      audience: student.guardian?.phone ? ("PARENT" as const) : ("STUDENT" as const),
      entity: { type: "Student", id },
      text: t("statementMessage", {
        center,
        student: student.name,
        charges: formatMoney(b.totalCharges),
        paid: formatMoney(b.totalPaid),
        balance: formatMoney(b.balance),
        currency,
      }),
    };
  }

  if (kind === "guardian") {
    const guardian = await db.guardian.findUnique({
      where: { id },
      include: { students: { where: { active: true }, select: { id: true } } },
    });
    if (!guardian) return null;
    const balances = await Promise.all(guardian.students.map((s) => getStudentBalance(s.id)));
    const family = balances.reduce(
      (a, b) => ({
        charges: a.charges + b.totalCharges,
        paid: a.paid + b.totalPaid,
        balance: a.balance + b.balance,
      }),
      { charges: 0, paid: 0, balance: 0 },
    );
    return {
      to: guardian.phone,
      audience: "PARENT" as const,
      entity: { type: "Guardian", id },
      text: t("familyStatementMessage", {
        center,
        guardian: guardian.name,
        children: guardian.students.length,
        charges: formatMoney(family.charges),
        paid: formatMoney(family.paid),
        balance: formatMoney(family.balance),
        currency,
      }),
    };
  }

  const teacher = await db.teacher.findUnique({ where: { id } });
  if (!teacher) return null;
  // The financial year to date is the span a teacher asks about; a narrower
  // window would answer a question nobody posed.
  const to = new Date();
  const from = new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
  const earnings = await getTeacherEarnings(id, from, to);
  return {
    to: teacher.phone,
    audience: "TEACHER" as const,
    entity: { type: "Teacher", id },
    text: t("teacherStatementMessage", {
      center,
      teacher: teacher.name,
      hours: earnings ? formatMoney(earnings.hours) : "0",
      due: earnings ? formatMoney(earnings.dueCommission) : "0",
      currency,
    }),
  };
}

/**
 * Send a statement — the figures in the message, the detail in a PDF.
 *
 * The summary is what somebody reads on a phone without opening anything; the
 * attachment is what they forward to whoever asked them about it. Sending only
 * the summary means every query comes back to the office, and sending only the
 * PDF means nobody reads it.
 */
export async function sendStatement(
  locale: string,
  kind: StatementKind,
  id: string,
): Promise<SendState> {
  const denied =
    kind === "teacher"
      ? await (async () => {
          // A teacher's earnings are payroll, and payroll is finance's.
          const s = await getSession();
          return s && (FINANCE_ROLES as readonly string[]).includes(s.role)
            ? null
            : { error: "forbidden" };
        })()
      : await staff();
  if (denied) return denied;

  const target = await recipientFor(kind, id, locale);
  if (!target) return { error: "notfound" };

  const token = await signStatementToken({ kind, id, locale });
  const base = await origin();
  const res = await sendDirect({
    to: target.to,
    text: target.text,
    event: "STATEMENT",
    audience: target.audience,
    entity: target.entity,
    attachments: base
      ? [
          {
            url: `${base}/api/statement/${token}`,
            mimetype: "application/pdf",
            filename: `statement-${kind}.pdf`,
          },
        ]
      : undefined,
  });

  if (res.ok) {
    await writeAudit(target.entity.type, id, "UPDATE", { after: { statementSent: true } });
  }
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
