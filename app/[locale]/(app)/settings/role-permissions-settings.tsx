"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ShieldCheck, Plus, Trash2, Copy } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { saveRoleMatrix, createCustomRole, deleteCustomRole } from "./permission-actions";

type Module = { key: string; roles: string[] };
type CustomRole = { id: string; key: string; name: string; baseRole: string };

/**
 * Roles & permissions matrix over built-in and custom roles. Tick which modules
 * each role sees; add or duplicate custom roles (a custom role borrows a
 * built-in "base" for its actual access, then only its menu is narrowed here).
 */
export function RolePermissionsSettings({
  modules,
  builtinRoles,
  customRoles,
  baseRoles,
  initialBuiltin,
  initialCustom,
}: {
  modules: Module[];
  builtinRoles: string[];
  customRoles: CustomRole[];
  baseRoles: string[];
  initialBuiltin: Record<string, Record<string, boolean>>;
  initialCustom: Record<string, Record<string, boolean>>;
}) {
  const t = useTranslations("rolePerms");
  const tn = useTranslations("nav");
  const tr = useTranslations("roles");
  const router = useRouter();

  const [builtin, setBuiltin] = useState(initialBuiltin);
  const [custom, setCustom] = useState(initialCustom);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);

  // add-role form
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [base, setBase] = useState("RECEPTIONIST");
  const [copyFrom, setCopyFrom] = useState("");

  const capabilityOf = (col: { kind: "builtin" | "custom"; key: string; baseRole?: string }) =>
    col.kind === "builtin" ? col.key : col.baseRole!;

  const columns = [
    ...builtinRoles.map((r) => ({ kind: "builtin" as const, key: r, label: tr(r), baseRole: r })),
    ...customRoles.map((c) => ({ kind: "custom" as const, key: c.key, label: c.name, baseRole: c.baseRole, id: c.id })),
  ];

  const allowed = (col: (typeof columns)[number], mod: string) => {
    if (col.kind === "builtin" && col.key === "ADMIN") return true;
    return col.kind === "builtin"
      ? builtin[col.key]?.[mod] !== false
      : custom[col.key]?.[mod] !== false;
  };

  const toggle = (col: (typeof columns)[number], mod: string) => {
    if (col.kind === "builtin" && col.key === "ADMIN") return;
    setSaved(false);
    if (col.kind === "builtin") {
      setBuiltin((p) => ({ ...p, [col.key]: { ...(p[col.key] ?? {}), [mod]: !(p[col.key]?.[mod] !== false) } }));
    } else {
      setCustom((p) => ({ ...p, [col.key]: { ...(p[col.key] ?? {}), [mod]: !(p[col.key]?.[mod] !== false) } }));
    }
  };

  const save = () =>
    start(async () => {
      const r = await saveRoleMatrix({ builtin, custom });
      if (r.ok) setSaved(true);
    });

  const addRole = () =>
    start(async () => {
      const r = await createCustomRole({ name, nameEn: nameEn || null, baseRole: base as never, copyFrom: copyFrom || null });
      if (r.ok) {
        setName("");
        setNameEn("");
        setCopyFrom("");
        router.refresh();
      }
    });

  const removeRole = (id: string) =>
    start(async () => {
      const r = await deleteCustomRole(id);
      if (r.ok) router.refresh();
    });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="p-2 text-start font-medium">{t("module")}</th>
              {columns.map((col) => (
                <th key={col.key} className="p-2 text-center font-medium">
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {col.kind === "builtin" && col.key === "ADMIN" && (
                        <ShieldCheck className="size-3.5 text-primary" />
                      )}
                    </span>
                    {col.kind === "custom" && (
                      <span className="inline-flex items-center gap-1">
                        <Badge variant="muted" className="text-[10px]">{tr(col.baseRole!)}</Badge>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => removeRole((col as { id: string }).id)}
                          aria-label={t("deleteRole")}
                          className="text-destructive hover:opacity-70"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <tr key={m.key} className="border-b border-border/60">
                <td className="p-2 font-medium">{tn(m.key)}</td>
                {columns.map((col) => {
                  const has = m.roles.includes(capabilityOf(col));
                  return (
                    <td key={col.key} className="p-2 text-center">
                      {has ? (
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={allowed(col, m.key)}
                          disabled={col.kind === "builtin" && col.key === "ADMIN"}
                          onChange={() => toggle(col, m.key)}
                          aria-label={`${col.label} — ${tn(m.key)}`}
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

      {/* Add / duplicate a custom role */}
      <div className="space-y-2 rounded-md border border-border p-3">
        <p className="flex items-center gap-1 text-sm font-medium">
          <Plus className="size-4" />
          {t("addRole")}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder={t("roleNameAr")} value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder={t("roleNameEn")} dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("baseRole")}
            <Select value={base} onChange={(e) => setBase(e.target.value)}>
              {baseRoles.map((r) => (
                <option key={r} value={r}>{tr(r)}</option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Copy className="size-3" />{t("duplicateFrom")}</span>
            <Select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">{t("noCopy")}</option>
              {columns.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </Select>
          </label>
        </div>
        <Button type="button" size="sm" disabled={pending || !name.trim()} onClick={addRole}>
          {t("createRole")}
        </Button>
      </div>
    </div>
  );
}
