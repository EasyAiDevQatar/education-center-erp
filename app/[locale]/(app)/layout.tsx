import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth } from "@/lib/rbac";
import { db } from "@/lib/db";
import { AppShell } from "@/components/app-shell/app-shell";
import { logoutAction } from "./actions";

export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await requireAuth(locale);
  const tr = await getTranslations("roles");

  // Optional-module switches. Read here (server) and passed down so the nav
  // updates on the next render after the setting changes — pages still guard
  // themselves; hiding items is UX, not enforcement.
  const accountingRow = await db.setting.findUnique({
    where: { key: "accountingEnabled" },
  });

  return (
    <AppShell
      role={session.role}
      userName={session.name}
      roleLabel={tr(session.role)}
      onLogout={logoutAction.bind(null, locale)}
      flags={{ accounting: accountingRow?.value === "1" }}
    >
      {children}
    </AppShell>
  );
}
