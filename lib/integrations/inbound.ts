import "server-only";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { getProvider, loadConfig } from "./registry";
import { normalizePhone } from "./phone";
import type { IntegrationConfig } from "./types";

/**
 * Inbound messages — the half of the conversation the centre could not hear.
 *
 * Outbound has worked (in intent) since the module was written: bookings,
 * reminders, receipts. A parent replying to any of it was answering into
 * nothing. This records what they said and who they are, and stops there.
 *
 * Deliberately inert. No auto-reply, no status change, no bot. A message that
 * silently cancels a lesson is worse than one nobody read, and "record it, show
 * it to a human" is the version that cannot be wrong.
 */

export type InboundResult = { ok: boolean; ignored?: string };

/** What the provider posts. Only the fields we actually read. */
type Payload = {
  id?: unknown;
  event?: unknown;
  data?: {
    id?: unknown;
    guid?: unknown;
    thread_guid?: unknown;
    thread?: unknown;
    text?: unknown;
    from_guid?: unknown;
    is_bot?: unknown;
    is_service?: unknown;
    // The message object is sometimes the text itself and sometimes nested.
    message?: unknown;
  };
};

const MESSAGE_EVENT = "chat.message.created";
const truthy = (v: unknown) => v === 1 || v === true || v === "1";
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/**
 * Match the caller's secret without leaking its length or contents through
 * timing. The set is tiny, so comparing against all of them costs nothing.
 */
async function integrationFor(secret: string) {
  if (!secret) return null;
  const candidates = await db.integration.findMany({
    where: { enabled: true, webhookSecret: { not: null } },
  });
  const given = Buffer.from(secret);
  for (const row of candidates) {
    const known = Buffer.from(row.webhookSecret!);
    if (known.length === given.length && timingSafeEqual(known, given)) return row;
  }
  return null;
}

/** Pull the message out of either payload shape the provider sends. */
function readMessage(payload: Payload) {
  const data = payload.data ?? {};
  const nested =
    data.message && typeof data.message === "object" ? (data.message as Record<string, unknown>) : {};

  const threadId = str(data.thread_guid ?? nested.thread_guid ?? data.thread).trim();
  const body = str(
    typeof data.message === "string" ? data.message : nested.message ?? nested.text ?? data.text,
  ).trim();
  const messageId = str(nested.id ?? data.id ?? data.guid);

  return {
    threadId,
    body,
    // Falling back to thread+message keeps the dedupe key stable even when the
    // provider omits its own event id.
    externalId: str(payload.id) || `${threadId}:${messageId}`,
    fromGuid: str(data.from_guid ?? nested.from_guid),
    isBot: truthy(data.is_bot) || truthy(nested.is_bot),
    isService: truthy(data.is_service) || truthy(nested.is_service),
  };
}

/**
 * Who does this number belong to?
 *
 * Every stored phone is normalised in JS rather than matched in SQL, because
 * the records hold whatever a person typed — "5555 1234", "+974-5555-1234",
 * "05551234" — and none of those are equal to each other in the database. At
 * one centre's scale this is a few hundred rows; if it ever is not, the fix is
 * a normalised column, not a cleverer query.
 */
async function matchPerson(phone: string | null) {
  if (!phone) return {};
  const [students, guardians, teachers, drivers] = await Promise.all([
    db.student.findMany({ where: { phone: { not: null } }, select: { id: true, phone: true } }),
    db.guardian.findMany({ where: { phone: { not: null } }, select: { id: true, phone: true } }),
    db.teacher.findMany({ where: { phone: { not: null } }, select: { id: true, phone: true } }),
    db.driver.findMany({ select: { id: true, employee: { select: { phone: true } } } }),
  ]);
  const hit = <T extends { id: string }>(rows: T[], of: (r: T) => string | null | undefined) =>
    rows.find((r) => normalizePhone(of(r)) === phone)?.id ?? null;

  return {
    studentId: hit(students, (r) => r.phone),
    guardianId: hit(guardians, (r) => r.phone),
    teacherId: hit(teachers, (r) => r.phone),
    driverId: hit(drivers, (r) => r.employee.phone),
  };
}

/** Ask the provider who is on the other end of a conversation. Best effort. */
async function contactOf(cfg: IntegrationConfig, threadId: string) {
  const provider = getProvider(cfg.provider);
  if (!provider?.lookupContact || !threadId) return { phone: null, name: null };
  try {
    return await provider.lookupContact(cfg, threadId);
  } catch {
    // An unmatched message is still worth keeping; the raw payload is stored.
    return { phone: null, name: null };
  }
}

export async function recordInbound(secret: string, payload: unknown): Promise<InboundResult> {
  const row = await integrationFor(secret);
  if (!row) return { ok: false, ignored: "unknownSecret" };

  const p = (payload ?? {}) as Payload;
  if (str(p.event) !== MESSAGE_EVENT) return { ok: true, ignored: "otherEvent" };

  const msg = readMessage(p);
  // Our own sends echo back, and service notices are not from a person.
  if (!msg.threadId || !msg.body) return { ok: true, ignored: "empty" };
  if (msg.isBot || msg.isService) return { ok: true, ignored: "notHuman" };

  const cfg = await loadConfig(row.provider);
  const contact = cfg ? await contactOf(cfg, msg.threadId) : { phone: null, name: null };
  const phone = normalizePhone(contact.phone);

  try {
    await db.inboundMessage.create({
      data: {
        provider: row.provider,
        externalId: msg.externalId,
        threadId: msg.threadId,
        contactName: contact.name?.slice(0, 120) ?? null,
        phone,
        body: msg.body.slice(0, 4000),
        raw: JSON.stringify(payload).slice(0, 8000),
        ...(await matchPerson(phone)),
      },
    });
  } catch (e) {
    // The provider retries anything that is not a 2xx, so the same message
    // arrives more than once by design. A duplicate is success, not an error.
    if ((e as { code?: string }).code === "P2002") return { ok: true, ignored: "duplicate" };
    throw e;
  }
  return { ok: true };
}
