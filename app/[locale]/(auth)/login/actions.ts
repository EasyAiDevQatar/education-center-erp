"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/session";
import { redirect } from "@/i18n/navigation";
import type { Role } from "@/lib/enums";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginState = { error?: string };

export async function loginAction(
  locale: string,
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "invalid" };

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !user.active) return { error: "invalid" };

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) return { error: "invalid" };

  await createSession({
    userId: user.id,
    name: user.name,
    role: user.role as Role,
    locale: user.locale,
    teacherId: user.teacherId,
    guardianId: user.guardianId,
  });

  // Send the user to the dashboard in their preferred locale.
  redirect({ href: "/", locale: user.locale || locale });
  // Unreachable (redirect throws) — satisfies the control-flow return check.
  return {};
}
