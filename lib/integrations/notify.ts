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
type Lang = "ar" | "en";

/**
 * What each event says, to each person.
 *
 * There used to be one sentence per event, sent to everybody, plus a driver
 * exception for two of them. So a driver was told "your session has been
 * rescheduled" about a lesson they do not attend, and a teacher was told
 * "thank you for your payment" about money they did not pay. The wording was
 * written for the family and everyone else received it by accident.
 *
 * DEFAULT is the fallback for an audience with nothing of its own — not a
 * shortcut, but the sentence that reads correctly to anyone. Where an audience
 * genuinely wants different words, it has them.
 *
 * A centre can override any of these from Messages → القوالب; these are what it
 * says until somebody does.
 */
type AudienceCopy = Partial<Record<Audience, Record<Lang, Tpl>>> & {
  DEFAULT: Record<Lang, Tpl>;
};

const TEMPLATES: Record<IntegrationEvent, AudienceCopy> = {
  SESSION_BOOKED: {
    DEFAULT: {
      ar: (v) => `${v.center}: تم حجز حصة لـ${v.student} مع ${v.teacher} يوم ${v.date} الساعة ${v.time} (${v.hours} ساعة).`,
      en: (v) => `${v.center}: Session booked for ${v.student} with ${v.teacher} on ${v.date} at ${v.time} (${v.hours}h).`,
    },
    PARENT: {
      ar: (v) => `${v.center}: تم حجز حصة لـ${v.student} مع ${v.teacher} يوم ${v.date} الساعة ${v.time} (${v.hours} ساعة) في ${v.location}.`,
      en: (v) => `${v.center}: A session for ${v.student} with ${v.teacher} is booked for ${v.date} at ${v.time} (${v.hours}h) at ${v.location}.`,
    },
    STUDENT: {
      ar: (v) => `${v.center}: عندك حصة مع ${v.teacher} يوم ${v.date} الساعة ${v.time} في ${v.location}. بالتوفيق!`,
      en: (v) => `${v.center}: You have a session with ${v.teacher} on ${v.date} at ${v.time} at ${v.location}. Good luck!`,
    },
    TEACHER: {
      ar: (v) => `${v.center}: حصة جديدة — ${v.student} يوم ${v.date} الساعة ${v.time} (${v.hours} ساعة) في ${v.location}.`,
      en: (v) => `${v.center}: New session — ${v.student} on ${v.date} at ${v.time} (${v.hours}h) at ${v.location}.`,
    },
    DRIVER: {
      ar: (v) => `${v.center}: توصيلة جديدة — ${v.student} يوم ${v.date} الساعة ${v.time} إلى ${v.location}.`,
      en: (v) => `${v.center}: New ride — ${v.student} on ${v.date} at ${v.time} to ${v.location}.`,
    },
  },

  SESSION_RESCHEDULED: {
    DEFAULT: {
      ar: (v) => `${v.center}: تم تغيير موعد حصة ${v.student} مع ${v.teacher} إلى ${v.date} الساعة ${v.time}.`,
      en: (v) => `${v.center}: ${v.student}'s session with ${v.teacher} moved to ${v.date} at ${v.time}.`,
    },
    PARENT: {
      ar: (v) => `${v.center}: تغيّر موعد حصة ${v.student} مع ${v.teacher} — أصبحت يوم ${v.date} الساعة ${v.time}.`,
      en: (v) => `${v.center}: ${v.student}'s session with ${v.teacher} has moved — it is now ${v.date} at ${v.time}.`,
    },
    STUDENT: {
      ar: (v) => `${v.center}: تغيّر موعد حصتك مع ${v.teacher} — أصبحت يوم ${v.date} الساعة ${v.time}.`,
      en: (v) => `${v.center}: Your session with ${v.teacher} has moved to ${v.date} at ${v.time}.`,
    },
    TEACHER: {
      ar: (v) => `${v.center}: تغيّر موعد حصتك مع ${v.student} — أصبحت يوم ${v.date} الساعة ${v.time}.`,
      en: (v) => `${v.center}: Your session with ${v.student} has moved to ${v.date} at ${v.time}.`,
    },
    DRIVER: {
      ar: (v) => `${v.center}: تغيّر موعد توصيلة ${v.student} — الحصة الآن يوم ${v.date} الساعة ${v.time}.`,
      en: (v) => `${v.center}: ${v.student}'s ride has moved — the session is now ${v.date} at ${v.time}.`,
    },
  },

  SESSION_CANCELLED: {
    DEFAULT: {
      ar: (v) => `${v.center}: تم إلغاء حصة ${v.student} مع ${v.teacher} بتاريخ ${v.date}.`,
      en: (v) => `${v.center}: ${v.student}'s session with ${v.teacher} on ${v.date} was cancelled.`,
    },
    PARENT: {
      ar: (v) => `${v.center}: أُلغيت حصة ${v.student} مع ${v.teacher} يوم ${v.date}. نعتذر عن أي إزعاج.`,
      en: (v) => `${v.center}: ${v.student}'s session with ${v.teacher} on ${v.date} has been cancelled. Sorry for the inconvenience.`,
    },
    STUDENT: {
      ar: (v) => `${v.center}: أُلغيت حصتك مع ${v.teacher} يوم ${v.date}.`,
      en: (v) => `${v.center}: Your session with ${v.teacher} on ${v.date} has been cancelled.`,
    },
    TEACHER: {
      ar: (v) => `${v.center}: أُلغيت حصتك مع ${v.student} يوم ${v.date} الساعة ${v.time}.`,
      en: (v) => `${v.center}: Your session with ${v.student} on ${v.date} at ${v.time} has been cancelled.`,
    },
    DRIVER: {
      ar: (v) => `${v.center}: أُلغيت حصة ${v.student} يوم ${v.date} — لا حاجة للتوصيلة.`,
      en: (v) => `${v.center}: ${v.student}'s session on ${v.date} was cancelled — no ride needed.`,
    },
  },

  CHECKED_IN: {
    DEFAULT: {
      ar: (v) => `${v.center}: تم تسجيل حضور ${v.student} الساعة ${v.time}.`,
      en: (v) => `${v.center}: ${v.student} checked in at ${v.time}.`,
    },
    PARENT: {
      ar: (v) => `${v.center}: وصل ${v.student} وبدأت الحصة الساعة ${v.time}.`,
      en: (v) => `${v.center}: ${v.student} has arrived and the session started at ${v.time}.`,
    },
    STUDENT: {
      ar: (v) => `${v.center}: تم تسجيل حضورك الساعة ${v.time}. حصة موفقة!`,
      en: (v) => `${v.center}: You are checked in at ${v.time}. Have a good session!`,
    },
    TEACHER: {
      ar: (v) => `${v.center}: حضر ${v.student} الساعة ${v.time}.`,
      en: (v) => `${v.center}: ${v.student} arrived at ${v.time}.`,
    },
    DRIVER: {
      ar: (v) => `${v.center}: تم تسليم ${v.student} الساعة ${v.time}.`,
      en: (v) => `${v.center}: ${v.student} was dropped off at ${v.time}.`,
    },
  },

  CHECKED_OUT: {
    DEFAULT: {
      ar: (v) => `${v.center}: تم تسجيل انصراف ${v.student} الساعة ${v.time}.`,
      en: (v) => `${v.center}: ${v.student} checked out at ${v.time}.`,
    },
    PARENT: {
      ar: (v) => `${v.center}: انتهت حصة ${v.student} الساعة ${v.time} (${v.hours} ساعة).`,
      en: (v) => `${v.center}: ${v.student}'s session ended at ${v.time} (${v.hours}h).`,
    },
    STUDENT: {
      ar: (v) => `${v.center}: انتهت حصتك الساعة ${v.time}. إلى اللقاء!`,
      en: (v) => `${v.center}: Your session ended at ${v.time}. See you next time!`,
    },
    TEACHER: {
      ar: (v) => `${v.center}: انتهت حصتك مع ${v.student} الساعة ${v.time} (${v.hours} ساعة).`,
      en: (v) => `${v.center}: Your session with ${v.student} ended at ${v.time} (${v.hours}h).`,
    },
    DRIVER: {
      ar: (v) => `${v.center}: ${v.student} جاهز للعودة الساعة ${v.time}.`,
      en: (v) => `${v.center}: ${v.student} is ready for the return trip at ${v.time}.`,
    },
  },

  SESSION_NO_SHOW: {
    DEFAULT: {
      ar: (v) => `${v.center}: لم يحضر ${v.student} حصة ${v.date} الساعة ${v.time}.`,
      en: (v) => `${v.center}: ${v.student} did not attend the ${v.date} session at ${v.time}.`,
    },
    PARENT: {
      ar: (v) => `${v.center}: لم يحضر ${v.student} حصة اليوم ${v.date} الساعة ${v.time}. للاستفسار تواصلوا معنا.`,
      en: (v) => `${v.center}: ${v.student} did not attend the session on ${v.date} at ${v.time}. Please get in touch if this is unexpected.`,
    },
    STUDENT: {
      ar: (v) => `${v.center}: سجّلنا غيابك عن حصة ${v.date} الساعة ${v.time}.`,
      en: (v) => `${v.center}: You were marked absent for the ${v.date} session at ${v.time}.`,
    },
    TEACHER: {
      ar: (v) => `${v.center}: لم يحضر ${v.student} حصتك يوم ${v.date} الساعة ${v.time}.`,
      en: (v) => `${v.center}: ${v.student} did not attend your session on ${v.date} at ${v.time}.`,
    },
    DRIVER: {
      ar: (v) => `${v.center}: لم يحضر ${v.student} يوم ${v.date} — لا حاجة لتوصيلة العودة.`,
      en: (v) => `${v.center}: ${v.student} did not attend on ${v.date} — no return trip needed.`,
    },
  },

  PAYMENT_RECEIVED: {
    DEFAULT: {
      ar: (v) => `${v.center}: تم استلام دفعة ${v.amount} ${v.currency} من ${v.student}. شكراً لكم.`,
      en: (v) => `${v.center}: Payment of ${v.amount} ${v.currency} received from ${v.student}. Thank you.`,
    },
    PARENT: {
      ar: (v) => `${v.center}: استلمنا ${v.amount} ${v.currency} عن ${v.student} — فاتورة رقم ${v.invoice}. شكراً لكم.`,
      en: (v) => `${v.center}: We received ${v.amount} ${v.currency} for ${v.student} — invoice ${v.invoice}. Thank you.`,
    },
    STUDENT: {
      ar: (v) => `${v.center}: سُجّلت دفعة ${v.amount} ${v.currency} على حسابك — فاتورة رقم ${v.invoice}.`,
      en: (v) => `${v.center}: A payment of ${v.amount} ${v.currency} was recorded on your account — invoice ${v.invoice}.`,
    },
    TEACHER: {
      ar: (v) => `${v.center}: تم استلام دفعة عن ${v.student} — فاتورة رقم ${v.invoice}.`,
      en: (v) => `${v.center}: A payment was received for ${v.student} — invoice ${v.invoice}.`,
    },
  },

  PAYOUT_PAID: {
    DEFAULT: {
      ar: (v) => `${v.center}: تم صرف مستحقاتك بمبلغ ${v.amount} ${v.currency}.`,
      en: (v) => `${v.center}: Your payout of ${v.amount} ${v.currency} has been paid.`,
    },
    TEACHER: {
      ar: (v) => `${v.center}: تم صرف مستحقاتك عن ${v.period} بمبلغ ${v.amount} ${v.currency}.`,
      en: (v) => `${v.center}: Your payout for ${v.period} — ${v.amount} ${v.currency} — has been paid.`,
    },
  },

  BALANCE_REMINDER: {
    DEFAULT: {
      ar: (v) => `${v.center}: تذكير — رصيد مستحق على ${v.student} بمبلغ ${v.amount} ${v.currency}.`,
      en: (v) => `${v.center}: Reminder — outstanding balance for ${v.student}: ${v.amount} ${v.currency}.`,
    },
    PARENT: {
      ar: (v) => `${v.center}: تذكير بالرصيد المستحق على ${v.student} وقدره ${v.amount} ${v.currency}. شكراً لتعاونكم.`,
      en: (v) => `${v.center}: A reminder that ${v.amount} ${v.currency} is outstanding for ${v.student}. Thank you.`,
    },
    STUDENT: {
      ar: (v) => `${v.center}: تذكير — عليك رصيد ${v.amount} ${v.currency}. يرجى مراجعة المكتب.`,
      en: (v) => `${v.center}: Reminder — ${v.amount} ${v.currency} is outstanding on your account. Please see the office.`,
    },
  },

  SESSION_REMINDER: {
    DEFAULT: {
      ar: (v) => `${v.center}: تذكير بحصة ${v.student} مع ${v.teacher} غداً ${v.date} الساعة ${v.time}.`,
      en: (v) => `${v.center}: Reminder — ${v.student} has a session with ${v.teacher} tomorrow ${v.date} at ${v.time}.`,
    },
    PARENT: {
      ar: (v) => `${v.center}: تذكير — حصة ${v.student} مع ${v.teacher} غداً ${v.date} الساعة ${v.time} في ${v.location}.`,
      en: (v) => `${v.center}: Reminder — ${v.student} has a session with ${v.teacher} tomorrow, ${v.date} at ${v.time}, at ${v.location}.`,
    },
    STUDENT: {
      ar: (v) => `${v.center}: تذكير — حصتك غداً ${v.date} الساعة ${v.time} مع ${v.teacher}. نراك على خير!`,
      en: (v) => `${v.center}: Reminder — your session is tomorrow, ${v.date} at ${v.time}, with ${v.teacher}. See you then!`,
    },
    TEACHER: {
      ar: (v) => `${v.center}: تذكير — حصتك مع ${v.student} غداً ${v.date} الساعة ${v.time} في ${v.location}.`,
      en: (v) => `${v.center}: Reminder — your session with ${v.student} is tomorrow, ${v.date} at ${v.time}, at ${v.location}.`,
    },
    DRIVER: {
      ar: (v) => `${v.center}: تذكير — توصيلة ${v.student} غداً ${v.date} الساعة ${v.time}.`,
      en: (v) => `${v.center}: Reminder — ${v.student}'s ride is tomorrow, ${v.date} at ${v.time}.`,
    },
  },

  PACKAGE_LOW: {
    DEFAULT: {
      ar: (v) => `${v.center}: تنبيه — باقة ${v.student} على وشك الانتهاء (${v.hours} ساعة متبقية).`,
      en: (v) => `${v.center}: Heads-up — ${v.student}'s package is running low (${v.hours}h remaining).`,
    },
    PARENT: {
      ar: (v) => `${v.center}: باقة ${v.student} على وشك الانتهاء — بقي ${v.hours} ساعة. يسعدنا تجديدها في أي وقت.`,
      en: (v) => `${v.center}: ${v.student}'s package is nearly used up — ${v.hours}h remain. We can renew it whenever suits you.`,
    },
    STUDENT: {
      ar: (v) => `${v.center}: باقتك على وشك الانتهاء — بقي ${v.hours} ساعة.`,
      en: (v) => `${v.center}: Your package is nearly used up — ${v.hours}h remain.`,
    },
  },
};

/** The built-in sentence for one audience, already rendered. */
export function builtInText(
  event: IntegrationEvent,
  audience: Audience,
  lang: Lang,
  vars: Vars,
): string {
  const copy = TEMPLATES[event];
  return (copy[audience] ?? copy.DEFAULT)[lang](vars);
}

/**
 * The built-in wording with the variable names left in place.
 *
 * The template editor shows this as the placeholder, so a centre can see both
 * what will be sent if it writes nothing and which variables the sentence is
 * built from — more useful than an empty box beside a list of names.
 */
export function builtInBody(event: IntegrationEvent, audience: Audience, lang: Lang): string {
  // A proxy that answers every lookup with its own name, so the built-in
  // function renders itself as a template rather than as a finished message.
  const echo = new Proxy({} as Vars, {
    get: (_target, key: string) => `{{${key}}}`,
  });
  return builtInText(event, audience, lang, echo);
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
          builtInText(event, r.audience, lang, vars),
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
