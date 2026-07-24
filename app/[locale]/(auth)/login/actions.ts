"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession } from "@/lib/session";
import { parseRoleKeys } from "@/lib/permissions";
import { redirect } from "@/i18n/navigation";
import type { Role } from "@/lib/enums";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginState = { error?: string };

/** Lockout policy: this many failures within the window locks the account. */
const MAX_FAILURES = 5;
const WINDOW_MIN = 10;

async function clientIp(): Promise<string | null> {
  const h = await headers();
  // nginx sets X-Real-IP / X-Forwarded-For in front of the app.
  return (
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

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

  const email = parsed.data.email.toLowerCase();
  const ip = await clientIp();

  // Rate limit: too many recent failures for this email → temporary lock.
  const windowStart = new Date(Date.now() - WINDOW_MIN * 60 * 1000);
  const recentFailures = await db.loginAttempt.count({
    where: { email, success: false, at: { gte: windowStart } },
  });
  if (recentFailures >= MAX_FAILURES) return { error: "locked" };

  const user = await db.user.findUnique({ where: { email } });
  const ok =
    user && user.active
      ? await verifyPassword(parsed.data.password, user.passwordHash)
      : false;

  await db.loginAttempt.create({ data: { email, ip, success: !!ok } });
  if (!ok) return { error: "invalid" };

  // Successful login clears the failure window.
  await db.loginAttempt.deleteMany({ where: { email, success: false } });

  await createSession({
    userId: user!.id,
    name: user!.name,
    role: user!.role as Role,
    activeRoleKey: user!.role,
    roleKeys: parseRoleKeys(user!.roleKeys, user!.role),
    locale: user!.locale,
    teacherId: user!.teacherId,
    guardianId: user!.guardianId,
    employeeId: user!.employeeId,
  });

  // Send the user to the dashboard in their preferred locale.
  redirect({ href: "/dashboard", locale: user!.locale || locale });
  // Unreachable (redirect throws) — satisfies the control-flow return check.
  return {};
}
