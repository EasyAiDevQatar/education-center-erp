import "server-only";
import { db } from "@/lib/db";
import { toNumber, formatMoney } from "@/lib/money";
import { getProvider, activeConfigsFor } from "./registry";
import { normalizePhone } from "./phone";
import { templatesFor, bodyFor } from "@/lib/messages/templates";
import type { Audience, IntegrationEvent } from "./types";

/**
 * Values available to message templates.
 *
 * The catalogue a centre sees when editing lives in lib/messages/render.ts and
 * must agree with what is populated below — a variable offered in the editor
 * and never set renders as nothing, which reads to the centre as a bug in
 * their template rather than in ours.
 */
type Vars = {
  student?: string;
  guardian?: string;
  teacher?: string;
  date?: string;
  time?: string;
  hours?: string;
  amount?: string;
  currency?: string;
  center?: string;
  /** Receipt number on a payment — the centre calls this the invoice number. */
  invoice?: string;
  method?: string;
  balance?: string;
  location?: string;
  price?: string;
  period?: string;
};

type Tpl = (v: Vars) => string;

/**
 * Driver wording for the two events that change a driver's day.
 *
 * The default templates are written for the family — "your session moved" —
 * and reach whoever is subscribed. A driver does not have a session; they have
 * a run to make, and the useful sentence is a different one. Events not listed
 * here fall back to the shared text, which is why a driver never receives, say,
 * a payment receipt worded as though it were theirs.
 */
const DRIVER_TEMPLATES: Partial<Record<IntegrationEvent, Record<"ar" | "en", Tpl>>> = {
  SESSION_RESCHEDULED: {
    ar: (v) => `${v.center}: تغيّر موعد توصيلة ${v.student} — الحصة الآن يوم ${v.date} الساعة ${v.time}.`,
    en: (v) => `${v.center}: ${v.student}'s ride has moved — the session is now ${v.date} at ${v.time}.`,
  },
  SESSION_CANCELLED: {
    ar: (v) => `${v.center}: أُلغيت حصة ${v.student} يوم ${v.date} — لا حاجة للتوصيلة.`,
    en: (v) => `${v.center}: ${v.student}'s session on ${v.date} was cancelled — no ride needed.`,
  },
};

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
  SESSION_NO_SHOW: {
    ar: (v) => `${v.center}: لم يحضر ${v.student} حصة ${v.date} الساعة ${v.time}.`,
    en: (v) => `${v.center}: ${v.student} did not attend the ${v.date} session at ${v.time}.`,
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

/**
 * The built-in wording with the variable names left in place.
 *
 * The template editor shows this as the placeholder, so a centre can see both
 * what will be sent if it writes nothing and which variables the sentence is
 * built from — more useful than an empty box beside a list of names.
 */
export function builtInBody(event: IntegrationEvent, lang: "ar" | "en"): string {
  // A proxy that answers every lookup with its own name, so the built-in
  // function renders itself as a template rather than as a finished message.
  const echo = new Proxy({} as Vars, {
    get: (_target, key: string) => `{{${key}}}`,
  });
  return TEMPLATES[event][lang](echo);
}

/**
 * Numbers the centre must never message: its own.
 *
 * A message from the centre to the centre is never useful, and it is worse
 * than useless in the provider's inbox — it arrives looking like a customer
 * conversation, so the operator sees their own booking confirmations queued
 * up next to real ones. It happens easily: whoever sets the system up puts
 * their own line on a test student, and every event comes straight back.
 *
 * `centerPhone` is included automatically; `messagingSelfNumbers` is for the
 * WhatsApp sender itself and any other line the office answers.
 */
async function selfNumbers(): Promise<Set<string>> {
  const rows = await db.setting.findMany({
    where: { key: { in: ["centerPhone", "messagingSelfNumbers"] } },
  });
  const out = new Set<string>();
  for (const row of rows) {
    for (const part of (row.value ?? "").split(/[,;\n]/)) {
      const phone = normalizePhone(part);
      if (phone) out.add(phone);
    }
  }
  return out;
}

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
    const driverText = DRIVER_TEMPLATES[event]?.[lang](vars) ?? text;
    // One query each for the whole dispatch rather than one per recipient.
    const stored = await templatesFor(event);
    const ours = await selfNumbers();

    // One message per handset per event.
    //
    // A child's contact number is very often the parent's, and a centre that
    // notifies both then sends the same sentence to the same phone twice. The
    // audiences are still separate — they decide WHETHER to send — but two
    // audiences resolving to one number is one message, to whichever of them
    // was resolved first.
    const alreadySent = new Set<string>();

    for (const cfg of configs) {
      const provider = getProvider(cfg.provider);
      if (!provider) continue;

      for (const r of recipients) {
        // Per event, not per configuration: the teacher who should hear about
        // a booking has no business being told what a family paid.
        if (!(cfg.matrix[event] ?? []).includes(r.audience)) continue;

        const body = bodyFor(
          stored,
          r.audience,
          lang,
          vars as Record<string, string | undefined>,
          r.audience === "DRIVER" ? driverText : text,
        );
        // Checked here rather than at the provider so the log records the
        // number that was actually dialled, and so an unusable one is a
        // SKIPPED row instead of a wasted call that comes back FAILED.
        const phone = normalizePhone(r.phone);

        const base = {
          provider: cfg.provider,
          event,
          audience: r.audience,
          recipient: phone ?? r.phone ?? "",
          message: body,
          entityType: entity?.type ?? null,
          entityId: entity?.id ?? null,
        };

        if (!phone) {
          await db.notificationLog.create({
            data: { ...base, status: "SKIPPED", error: r.phone ? "badPhone" : "noPhone" },
          });
          continue;
        }

        if (ours.has(phone)) {
          await db.notificationLog.create({
            data: { ...base, status: "SKIPPED", error: "ownNumber" },
          });
          continue;
        }

        if (alreadySent.has(phone)) {
          // Logged rather than dropped silently: "why did the teacher not get
          // this" is answered by a row saying the parent already had it on the
          // same number.
          await db.notificationLog.create({
            data: { ...base, status: "SKIPPED", error: "duplicateNumber" },
          });
          continue;
        }
        alreadySent.add(phone);

        const res = await provider.send(cfg, { to: phone, text: body });
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
    | "SESSION_BOOKED"
    | "SESSION_RESCHEDULED"
    | "SESSION_CANCELLED"
    | "CHECKED_IN"
    | "CHECKED_OUT"
    | "SESSION_NO_SHOW"
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

    // Whoever is driving this lesson, via the stop that serves it. Distinct
    // because a session can have both a pickup and a drop-off on the same
    // trip, and one driver should not be messaged twice about one change.
    const stops = await db.tripStop.findMany({
      where: { sessionId, trip: { driverId: { not: null }, status: { notIn: ["CANCELLED"] } } },
      select: { trip: { select: { driverId: true, driver: { select: { employee: { select: { phone: true } } } } } } },
    });
    const driverPhones = [
      ...new Map(
        stops
          .filter((st) => st.trip.driver?.employee.phone)
          .map((st) => [st.trip.driverId, st.trip.driver!.employee.phone!]),
      ).values(),
    ];

    await dispatch(
      event,
      [
        { audience: "TEACHER", phone: s.teacher?.phone ?? null },
        { audience: "STUDENT", phone: s.student.phone },
        { audience: "PARENT", phone: s.student.guardian?.phone ?? null },
        ...driverPhones.map((phone) => ({ audience: "DRIVER" as const, phone })),
      ],
      {
        student: s.student.name,
        guardian: s.student.guardian?.name ?? "",
        teacher: s.teacher?.name ?? "",
        date: fmtDate(s.date),
        time: fmtTime(s.date),
        hours: String(toNumber(s.hours)),
        location: s.location === "HOME" ? "المنزل" : "المركز",
        price: formatMoney(s.total),
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
        guardian: p.student?.guardian?.name ?? "",
        amount: formatMoney(p.amount),
        // The receipt number is what the centre calls the invoice number, and
        // it is the single most useful thing to put in a payment message: it
        // is what a parent quotes back when they ring about it.
        invoice: p.receiptNo,
        method: p.method ?? "",
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
      include: { teacher: true, employee: true },
    });
    if (!p) return;
    const { center, currency } = await centerSettings();

    await dispatch(
      "PAYOUT_PAID",
      [{ audience: "TEACHER", phone: p.teacher?.phone ?? p.employee?.phone ?? null }],
      {
        teacher: p.teacher?.name ?? p.employee?.name ?? "",
        amount: formatMoney(p.netPaid),
        currency,
        center,
      },
      { type: "TeacherPayout", id: p.id },
    );
  } catch {
    /* swallow */
  }
}
