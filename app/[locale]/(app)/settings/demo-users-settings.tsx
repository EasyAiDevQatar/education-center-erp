"use client";

import { useTranslations } from "next-intl";
import { KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type DemoUser = { name: string; email: string; role: string };

/**
 * Read-only reference of the seeded demo accounts, so anyone can sign in as each
 * role to try the system. All share one password (demo data only).
 */
export function DemoUsersSettings({ users, password }: { users: DemoUser[]; password: string }) {
  const t = useTranslations("demoUsers");
  const tr = useTranslations("roles");

  if (users.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("none")}</p>;
  }

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <KeyRound className="size-4" />
        {t("passwordNote")}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground" dir="ltr">
          {password}
        </code>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="p-2 text-start font-medium">{t("name")}</th>
              <th className="p-2 text-start font-medium">{t("email")}</th>
              <th className="p-2 text-start font-medium">{t("role")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email} className="border-b border-border/60">
                <td className="p-2 font-medium">{u.name}</td>
                <td className="p-2" dir="ltr">{u.email}</td>
                <td className="p-2"><Badge variant="muted">{tr(u.role)}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
