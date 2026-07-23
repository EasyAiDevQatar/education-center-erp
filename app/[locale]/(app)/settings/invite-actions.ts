"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/password";

export type InviteState = { ok?: boolean; error?: string };

const schema = z.object({
  kind: z.enum(["teacher", "guardian", "employee"]),
  recordId: z.string().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
});

/**
 * Create a portal login for an existing teacher, guardian or employee.
 *
 * The `employee` kind creates a DRIVER account for the driver app; the person
 * keeps their single Employee record and simply gains a way to sign in.
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
      : d.kind === "guardian"
        ? await db.user.findUnique({ where: { guardianId: d.recordId } })
        : await db.user.findUnique({ where: { employeeId: d.recordId } });
  if (linked) return { error: "alreadyLinked" };

  const record =
    d.kind === "teacher"
      ? await db.teacher.findUnique({ where: { id: d.recordId } })
      : d.kind === "guardian"
        ? await db.guardian.findUnique({ where: { id: d.recordId } })
        : await db.employee.findUnique({ where: { id: d.recordId } });
  if (!record) return { error: "notfound" };

  // A driver login is only meaningful for someone who actually drives.
  if (d.kind === "employee") {
    const driver = await db.driver.findUnique({ where: { employeeId: d.recordId } });
    if (!driver) return { error: "notADriver" };
  }

  const user = await db.user.create({
    data: {
      name: record.name,
      email: d.email,
      passwordHash: await hashPassword(d.password),
      role: d.kind === "teacher" ? "TEACHER" : d.kind === "guardian" ? "PARENT" : "DRIVER",
      locale,
      active: true,
      ...(d.kind === "teacher"
        ? { teacherId: d.recordId }
        : d.kind === "guardian"
          ? { guardianId: d.recordId }
          : { employeeId: d.recordId }),
    },
  });

  await writeAudit("User", user.id, "CREATE", {
    after: { role: user.role, linkedTo: d.kind, portalInvite: true },
  });
  const section =
    d.kind === "teacher" ? "teachers" : d.kind === "guardian" ? "guardians" : "hr";
  revalidatePath(`/${locale}/${section}/${d.recordId}`);
  revalidatePath(`/${locale}/settings`);
  return { ok: true };
}
