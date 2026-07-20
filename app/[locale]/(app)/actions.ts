"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { destroySession, getSession } from "@/lib/session";
import { verifyPassword, hashPassword } from "@/lib/password";
import { writeAudit } from "@/lib/audit";
import { redirect } from "@/i18n/navigation";

export async function logoutAction(locale: string) {
  await destroySession();
  redirect({ href: "/login", locale });
}

export type PasswordState = { ok?: boolean; error?: string };

const pwSchema = z.object({
  current: z.string().min(1),
  next: z.string().min(8),
  confirm: z.string().min(1),
});

/** Any signed-in user may change their own password (current one required). */
export async function changeOwnPassword(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const session = await getSession();
  if (!session) return { error: "forbidden" };

  const parsed = pwSchema.safeParse({
    current: formData.get("current"),
    next: formData.get("next"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: "passwordShort" };
  const d = parsed.data;
  if (d.next !== d.confirm) return { error: "passwordMismatch" };

  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user) return { error: "forbidden" };
  if (!(await verifyPassword(d.current, user.passwordHash))) {
    return { error: "wrongPassword" };
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(d.next) },
  });
  await writeAudit("User", user.id, "UPDATE", { after: { passwordChanged: true } });
  return { ok: true };
}
