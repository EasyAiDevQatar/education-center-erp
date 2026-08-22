"use server";

import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { sendDirect } from "@/lib/integrations/notify";

export type ShareState = { ok?: boolean; error?: string };

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
  });
  if (res.ok) await writeAudit("Student", student.id, "UPDATE", { after: { checkinCodeSent: true } });
  return res.ok ? { ok: true } : { error: res.error ?? "failed" };
}
