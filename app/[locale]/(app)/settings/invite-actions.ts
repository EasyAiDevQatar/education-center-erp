"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/password";

export type InviteState = { ok?: boolean; error?: string };

const schema = z.object({
  kind: z.enum(["teacher", "guardian"]),
  recordId: z.string().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
});

/**
 * Create a portal login for an existing teacher or guardian.
 *
 * The password is set by the admin here rather than emailed, because the centre
 * has no outbound mail configured — they hand it over and the user changes it
 * from the header menu. It is hashed immediately and never stored in the clear.
 */
export async function createPortalLogin(
  locale: string,
  input: z.infer<typeof schema>,
): Promise<InviteState> {
  const s = await getSession();
  if (!s || s.role !== "ADMIN") return { error: "forbidden" };

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const d = parsed.data;

  const existingEmail = await db.user.findUnique({ where: { email: d.email } });
  if (existingEmail) return { error: "emailTaken" };

  // The link columns are unique — one login per teacher/guardian record.
  const linked =
    d.kind === "teacher"
      ? await db.user.findUnique({ where: { teacherId: d.recordId } })
      : await db.user.findUnique({ where: { guardianId: d.recordId } });
  if (linked) return { error: "alreadyLinked" };

  const record =
    d.kind === "teacher"
      ? await db.teacher.findUnique({ where: { id: d.recordId } })
      : await db.guardian.findUnique({ where: { id: d.recordId } });
  if (!record) return { error: "notfound" };

  const user = await db.user.create({
    data: {
      name: record.name,
      email: d.email,
      passwordHash: await hashPassword(d.password),
      role: d.kind === "teacher" ? "TEACHER" : "PARENT",
      locale,
      active: true,
      ...(d.kind === "teacher" ? { teacherId: d.recordId } : { guardianId: d.recordId }),
    },
  });

  await writeAudit("User", user.id, "CREATE", {
    after: { role: user.role, linkedTo: d.kind, portalInvite: true },
  });
  revalidatePath(`/${locale}/${d.kind === "teacher" ? "teachers" : "guardians"}/${d.recordId}`);
  revalidatePath(`/${locale}/settings`);
  return { ok: true };
}
