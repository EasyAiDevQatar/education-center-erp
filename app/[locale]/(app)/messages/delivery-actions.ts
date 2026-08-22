"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { INTEGRATION_EVENTS, AUDIENCES } from "@/lib/integrations/types";

export type DeliveryState = { ok?: boolean; error?: string };

/**
 * Who hears about what.
 *
 * Deliberately not behind the messaging module's password. That lock exists to
 * keep the API key away from anyone who wanders past an unlocked screen; it is
 * not a reason to make the receptionist find an administrator every time the
 * centre decides parents should also hear about absences. The credential and
 * the editorial decision are different kinds of secret, and only one of them
 * is a secret at all.
 */
async function guard() {
  const s = await getSession();
  if (!s || !(STAFF_ROLES as readonly string[]).includes(s.role)) return { error: "forbidden" };
  return null;
}

const schema = z.object({
  provider: z.string().min(1),
  /** {event: [audience]}. An event with an empty list is simply not sent. */
  matrix: z.record(z.enum(INTEGRATION_EVENTS), z.array(z.enum(AUDIENCES))),
});

export async function saveDelivery(
  locale: string,
  input: z.infer<typeof schema>,
): Promise<DeliveryState> {
  const denied = await guard();
  if (denied) return denied;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const { provider, matrix } = parsed.data;

  const existing = await db.integration.findUnique({ where: { provider } });
  if (!existing) return { error: "notConfigured" };

  // Drop the empties so the stored object says what is on rather than listing
  // every event the product has ever had.
  const clean = Object.fromEntries(
    Object.entries(matrix).filter(([, people]) => (people ?? []).length > 0),
  );

  // Only these columns. The credential screen owns the rest, and neither screen
  // may blank what the other holds. `events` and `audiences` are kept in step
  // so anything still reading them sees the same picture.
  await db.integration.update({
    where: { provider },
    data: {
      deliveryMatrix: JSON.stringify(clean),
      events: JSON.stringify(Object.keys(clean)),
      audiences: JSON.stringify([...new Set(Object.values(clean).flat())]),
    },
  });
  await writeAudit("Integration", provider, "UPDATE", { after: { deliveryMatrix: clean } });
  revalidatePath(`/${locale}/messages`);
  return { ok: true };
}
