import "server-only";
import { db } from "@/lib/db";
import { toNumber, formatMoney } from "@/lib/money";
import { getProvider, activeConfigsFor } from "./registry";
import type { Audience, IntegrationEvent } from "./types";

/** Values available to message templates. */
type Vars = {
  student?: string;
  teacher?: string;
  date?: string;
  time?: string;
  hours?: string;
  amount?: string;
  currency?: string;
  center?: string;
};

type Tpl = (v: Vars) => string;

/** Bilingual templates, keyed by event then audience. */
const TEMPLATES: Record<IntegrationEvent, Record<"ar" | "en", Tpl>> = {
  SESSION_BOOKED: {
    ar: (v) => `${v.center}: تم حجز حصة لـ${v.student} مع ${v.teacher} يوم ${v.date} الساعة ${v.time} (${v.hours} ساعة).`,
    en: (v) => `${v.center}: Session booked for ${v.student} with ${v.teacher} on ${v.date} at ${v.time} (${v.hours}h).`,
  },
  SESSION_RESCHEDULED: {
    ar: (v) => `${v.center}: تم تغيير موعد حصة ${v.student} مع ${v.teacher} إلى ${v.date} الساعة ${v.time}.`,
    en: (v) => `${v.center}: ${v.student}'s session with ${v.teacher} moved to ${v.date} at ${v.time}.`,
  },
  SESSION_CANCELLED: {
    ar: (v) => `${v.center}: تم إلغاء حصة ${v.student} مع ${v.teacher} بتاريخ ${v.date}.`,
    en: (v) => `${v.center}: ${v.student}'s session with ${v.teacher} on ${v.date} was cancelled.`,
  },
  CHECKED_IN: {
    ar: (v) => `${v.center}: تم تسجيل حضور ${v.student} الساعة ${v.time}.`,
    en: (v) => `${v.center}: ${v.student} checked in at ${v.time}.`,
  },
  CHECKED_OUT: {
    ar: (v) => `${v.center}: تم تسجيل انصراف ${v.student} الساعة ${v.time}.`,
    en: (v) => `${v.center}: ${v.student} checked out at ${v.time}.`,
  },
  PAYMENT_RECEIVED: {
    ar: (v) => `${v.center}: تم استلام دفعة ${v.amount} ${v.currency} من ${v.student}. شكراً لكم.`,
    en: (v) => `${v.center}: Payment of ${v.amount} ${v.currency} received from ${v.student}. Thank you.`,
  },
  PAYOUT_PAID: {
    ar: (v) => `${v.center}: تم صرف مستحقاتك بمبلغ ${v.amount} ${v.currency}.`,
    en: (v) => `${v.center}: Your payout of ${v.amount} ${v.currency} has been paid.`,
  },
  BALANCE_REMINDER: {
    ar: (v) => `${v.center}: تذكير — رصيد مستحق على ${v.student} بمبلغ ${v.amount} ${v.currency}.`,
    en: (v) => `${v.center}: Reminder — outstanding balance for ${v.student}: ${v.amount} ${v.currency}.`,
  },
  SESSION_REMINDER: {
    ar: (v) => `${v.center}: تذكير بحصة ${v.student} مع ${v.teacher} غداً ${v.date} الساعة ${v.time}.`,
    en: (v) => `${v.center}: Reminder — ${v.student} has a session with ${v.teacher} tomorrow ${v.date} at ${v.time}.`,
  },
  PACKAGE_LOW: {
    ar: (v) => `${v.center}: تنبيه — باقة ${v.student} على وشك الانتهاء (${v.hours} ساعة متبقية).`,
    en: (v) => `${v.center}: Heads-up — ${v.student}'s package is running low (${v.hours}h remaining).`,
  },
};

async function centerSettings() {
  const rows = await db.setting.findMany({
    where: { key: { in: ["centerName", "currency", "language"] } },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const lang = map.language === "en" ? "en" : "ar";
  return {
    center: map.centerName ?? "Education Center",
    currency: map.currency ?? "QAR",
    lang: lang as "ar" | "en",
  };
}

type Recipient = { audience: Audience; phone: string | null };

/**
 * Deliver one event to every enabled provider/audience. Failures are logged to
 * NotificationLog and swallowed — notifications must never break the business
 * action that triggered them.
 */
export async function dispatch(
  event: IntegrationEvent,
  recipients: Recipient[],
  vars: Vars,
  entity?: { type: string; id: string },
): Promise<void> {
  try {
    const configs = await activeConfigsFor(event);
    if (configs.length === 0) return;
    const { lang } = await centerSettings();
    const text = TEMPLATES[event][lang](vars);

    for (const cfg of configs) {
      const provider = getProvider(cfg.provider);
      if (!provider) continue;

      for (const r of recipients) {
        if (!cfg.audiences.includes(r.audience)) continue;

        const base = {
          provider: cfg.provider,
          event,
          audience: r.audience,
          recipient: r.phone ?? "",
          message: text,
          entityType: entity?.type ?? null,
          entityId: entity?.id ?? null,
        };

        if (!r.phone) {
          await db.notificationLog.create({
            data: { ...base, status: "SKIPPED", error: "noPhone" },
          });
          continue;
        }

        const res = await provider.send(cfg, { to: r.phone, text });
        await db.notificationLog.create({
          data: {
            ...base,
            status: res.ok ? "SENT" : "FAILED",
            error: res.ok ? null : [res.error, res.message].filter(Boolean).join(" — ").slice(0, 500),
          },
        });
      }
    }
  } catch {
    // Never propagate — the caller's transaction has already succeeded.
  }
}

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function fmtTime(d: Date) {
  return d.toISOString().slice(11, 16);
}

/** Notify about a session lifecycle event. */
export { centerSettings };

export async function notifySession(
  event: Extract<
    IntegrationEvent,
    "SESSION_BOOKED" | "SESSION_RESCHEDULED" | "SESSION_CANCELLED" | "CHECKED_IN" | "CHECKED_OUT"
  >,
  sessionId: string,
): Promise<void> {
  try {
    const s = await db.session.findUnique({
      where: { id: sessionId },
      include: { student: { include: { guardian: true } }, teacher: true },
    });
    if (!s) return;
    const { center, currency } = await centerSettings();

    await dispatch(
      event,
      [
        { audience: "TEACHER", phone: s.teacher.phone },
        { audience: "STUDENT", phone: s.student.phone },
        { audience: "PARENT", phone: s.student.guardian?.phone ?? null },
      ],
      {
        student: s.student.name,
        teacher: s.teacher.name,
        date: fmtDate(s.date),
        time: fmtTime(s.date),
        hours: String(toNumber(s.hours)),
        center,
        currency,
      },
      { type: "Session", id: s.id },
    );
  } catch {
    /* swallow */
  }
}

/** Notify about a received payment. */
export async function notifyPayment(paymentId: string): Promise<void> {
  try {
    const p = await db.payment.findUnique({
      where: { id: paymentId },
      include: { student: { include: { guardian: true } } },
    });
    if (!p) return;
    const { center, currency } = await centerSettings();

    await dispatch(
      "PAYMENT_RECEIVED",
      [
        { audience: "STUDENT", phone: p.student?.phone ?? null },
        { audience: "PARENT", phone: p.student?.guardian?.phone ?? null },
      ],
      {
        student: p.student?.name ?? "—",
        amount: formatMoney(p.amount),
        currency,
        center,
        date: fmtDate(p.date),
      },
      { type: "Payment", id: p.id },
    );
  } catch {
    /* swallow */
  }
}

/** Notify a teacher that their payout was paid. */
export async function notifyPayout(payoutId: string): Promise<void> {
  try {
    const p = await db.teacherPayout.findUnique({
      where: { id: payoutId },
      include: { teacher: true },
    });
    if (!p) return;
    const { center, currency } = await centerSettings();

    await dispatch(
      "PAYOUT_PAID",
      [{ audience: "TEACHER", phone: p.teacher.phone }],
      { teacher: p.teacher.name, amount: formatMoney(p.netPaid), currency, center },
      { type: "TeacherPayout", id: p.id },
    );
  } catch {
    /* swallow */
  }
}
