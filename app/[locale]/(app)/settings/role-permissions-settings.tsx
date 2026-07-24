"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { saveRolePermissions } from "./permission-actions";

type Module = { key: string; roles: string[] };

/**
 * Roles & permissions matrix: for each staff role, tick the modules it may see
 * in the menu. Admin is shown for reference but always has everything. Unticking
 * only hides a module from that role's sidebar.
 */
export function RolePermissionsSettings({
  modules,
  roles,
  initial,
}: {
  modules: Module[];
  roles: string[];
  initial: Record<string, Record<string, boolean>>;
}) {
  const t = useTranslations("rolePerms");
  const tn = useTranslations("nav");
  const tr = useTranslations("roles");
  const [perms, setPerms] = useState(initial);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  const allowed = (role: string, key: string) =>
    role === "ADMIN" ? true : perms[role]?.[key] !== false;

  const toggle = (role: string, key: string) => {
    if (role === "ADMIN") return;
    setSaved(false);
    setPerms((prev) => ({
      ...prev,
      [role]: { ...(prev[role] ?? {}), [key]: !(prev[role]?.[key] !== false) },
    }));
  };

  const save = () =>
    start(async () => {
      const r = await saveRolePermissions(perms);
      if (r.ok) setSaved(true);
    });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="p-2 text-start font-medium">{t("module")}</th>
              {roles.map((role) => (
                <th key={role} className="p-2 text-center font-medium">
                  {tr(role)}
                  {role === "ADMIN" && (
                    <ShieldCheck className="ms-1 inline size-3.5 text-primary" />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <tr key={m.key} className="border-b border-border/60">
                <td className="p-2 font-medium">{tn(m.key)}</td>
                {roles.map((role) => {
                  const has = role === "ADMIN" || m.roles.includes(role);
                  return (
                    <td key={role} className="p-2 text-center">
                      {has ? (
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={allowed(role, m.key)}
                          disabled={role === "ADMIN"}
                          onChange={() => toggle(role, m.key)}
                          aria-label={`${tr(role)} — ${tn(m.key)}`}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        {saved && <Badge variant="success">{t("saved")}</Badge>}
      </div>
    </div>
  );
}
