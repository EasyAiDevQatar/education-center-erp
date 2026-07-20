import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAuth } from "@/lib/rbac";
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

  return (
    <AppShell
      role={session.role}
      userName={session.name}
      roleLabel={tr(session.role)}
      onLogout={logoutAction.bind(null, locale)}
    >
      {children}
    </AppShell>
  );
}
