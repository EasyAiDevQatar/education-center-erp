"use server";

import { destroySession } from "@/lib/session";
import { redirect } from "@/i18n/navigation";

export async function logoutAction(locale: string) {
  await destroySession();
  redirect({ href: "/login", locale });
}
