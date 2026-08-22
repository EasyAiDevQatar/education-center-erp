"use server";

import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { headers } from "next/headers";
import { sendDirect } from "@/lib/integrations/notify";
import { signStatementToken } from "@/lib/statement-token";

export type ShareState = { ok?: boolean; error?: string };

/** The origin this instance answers on — staging attaches its own, not production's. */
async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

/**
 * The student's card as a scannable image, on a signed link.
 *
 * Returns nothing when the origin is unknown rather than guessing at a URL:
 * an attachment the provider cannot fetch fails the whole message, and a code
 * that arrives as text alone is still useful.
 */
async function cardImage(studentId: string, locale: string, base: string) {
  if (!base) return undefined;
  const token = await signStatementToken({ kind: "checkin-code", id: studentId, locale });
  return [
    {
      url: `${base}/api/qr/${token}`,
      mimetype: "image/png",
      filename: "checkin-code.png",
    },
  ];
}

/**
 * Send one student's check-in code to their guardian, from the centre's own
 * WhatsApp rather than from whoever is standing at the desk.
 *
 * The guardian is the recipient, falling back to the student's own number: a
 * code belongs with whoever brings the child, and an older student who carries
 * their own phone is the same person.
 */
export async function sendCheckinCode(locale: string, studentId: string): Promise<ShareState> {
  const session = await getSession();
  if (!session || !(STAFF_ROLES as readonly string[]).includes(session.role)) {
    return { error: "forbidden" };
  }

  const student = await db.student.findUnique({
    where: { id: studentId },
    include: { guardian: { select: { phone: true } } },
  });
  if (!student) return { error: "notfound" };
  if (!student.qrToken) return { error: "noCode" };

  const to = student.guardian?.phone ?? student.phone;
  const [t, centre] = await Promise.all([
    getTranslations({ locale, namespace: "checkin" }),
    db.setting.findUnique({ where: { key: "centerName" } }),
  ]);

  const text = t("shareMessage", {
    name: student.name,
    code: student.qrToken,
    center: centre?.value ?? "",
  });

  const res = await sendDirect({
    to,
    text,
    event: "CHECKIN_CODE",
    audience: student.guardian?.phone ? "PARENT" : "STUDENT",
    entity: { type: "Student", id: student.id },
    attachments: await cardImage(student.id, locale, await origin()),
  });
  if (res.ok) await writeAudit("Student", student.id, "UPDATE", { after: { checkinCodeSent: true } });
  return res.ok ? { ok: true } : { error: res.error ?? "failed" };
}

export type CodeRun = {
  sent: number;
  /** Already had it recently — a code does not change, so twice is noise. */
  skippedRecent: number;
  /** Nobody to send to. These families have to be handed a card by hand. */
  unreachable: number;
  /** No code issued yet — generate the cards first. */
  noCode: number;
};

/** Days before the same family is sent the same code again. */
const CODE_COOLDOWN_DAYS = 30;

/**
 * Send every active student's code to their family.
 *
 * The cooldown is the point. A check-in code does not change, so re-sending it
 * is not new information — it is the centre appearing in fifty chats with
 * something they already have. A family sent one this month is skipped, and
 * pressing the button twice does not undo that.
 *
 * Reports the families it could not reach, because those are the cards
 * somebody has to hand over in person.
 */
export async function sendAllCheckinCodes(locale: string): Promise<ShareState & { run?: CodeRun }> {
  const session = await getSession();
  if (!session || !(STAFF_ROLES as readonly string[]).includes(session.role)) {
    return { error: "forbidden" };
  }

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - CODE_COOLDOWN_DAYS);

  const students = await db.student.findMany({
    where: { active: true },
    include: { guardian: { select: { phone: true } } },
  });

  const [t, centre] = await Promise.all([
    getTranslations({ locale, namespace: "checkin" }),
    db.setting.findUnique({ where: { key: "centerName" } }),
  ]);
  const center = centre?.value ?? "";

  const base = await origin();
  const run: CodeRun = { sent: 0, skippedRecent: 0, unreachable: 0, noCode: 0 };

  for (const student of students) {
    if (!student.qrToken) {
      run.noCode++;
      continue;
    }
    const to = student.guardian?.phone ?? student.phone;
    if (!to) {
      run.unreachable++;
      continue;
    }

    const recent = await db.notificationLog.findFirst({
      where: {
        event: "CHECKIN_CODE",
        entityId: student.id,
        status: "SENT",
        createdAt: { gte: since },
      },
    });
    if (recent) {
      run.skippedRecent++;
      continue;
    }

    const res = await sendDirect({
      to,
      text: t("shareMessage", { name: student.name, code: student.qrToken, center }),
      event: "CHECKIN_CODE",
      audience: student.guardian?.phone ? "PARENT" : "STUDENT",
      entity: { type: "Student", id: student.id },
      attachments: await cardImage(student.id, locale, base),
    });
    if (res.ok) run.sent++;
    else run.unreachable++;
  }

  await writeAudit("Student", "bulk-checkin-codes", "UPDATE", { after: run });
  return { ok: true, run };
}
