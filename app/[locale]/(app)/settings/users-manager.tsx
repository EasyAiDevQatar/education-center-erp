"use client";

import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil } from "lucide-react";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePagination, TablePagination } from "@/components/ui/table-pagination";
import { ROLES } from "@/lib/enums";
import { saveUser } from "./users-actions";

export type Opt = { id: string; label: string };
export type UserRow = {
  id: string;
  name: string;
  nameEn: string | null;
  email: string;
  role: string;
  roleKeys: string[];
  locale: string;
  active: boolean;
  teacherId: string | null;
  guardianId: string | null;
  linkedLabel: string | null;
};

function UserFields({ user, teachers, guardians, roleOptions }: { user?: UserRow; teachers: Opt[]; guardians: Opt[]; roleOptions: { key: string; label: string }[] }) {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={tc("nameAr")} htmlFor="u-name">
          <Input id="u-name" name="name" defaultValue={user?.name} required />
        </FormField>
        <FormField label={tc("nameEn")} htmlFor="u-nameEn">
          <Input id="u-nameEn" name="nameEn" dir="ltr" defaultValue={user?.nameEn ?? ""} />
        </FormField>
        <FormField label={tc("email")} htmlFor="u-email">
          <Input id="u-email" name="email" type="email" dir="ltr" defaultValue={user?.email} required />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("role")} htmlFor="u-role">
          <Select id="u-role" name="role" defaultValue={user?.role ?? "RECEPTIONIST"}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{tr(r)}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("language")} htmlFor="u-locale">
          <Select id="u-locale" name="locale" defaultValue={user?.locale ?? "ar"}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </Select>
        </FormField>
      </div>
      {roleOptions.length > 0 && (
        <FormField label={t("additionalRoles")} htmlFor="u-roleKeys">
          <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-md border border-border p-2">
            {roleOptions.map((r) => (
              <label key={r.key} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name="roleKeys"
                  value={r.key}
                  defaultChecked={user?.roleKeys?.includes(r.key)}
                  className="size-4 accent-primary"
                />
                {r.label}
              </label>
            ))}
          </div>
        </FormField>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("linkTeacher")} htmlFor="u-teacher">
          <Select id="u-teacher" name="teacherId" defaultValue={user?.teacherId ?? ""}>
            <option value="">—</option>
            {teachers.map((x) => (
              <option key={x.id} value={x.id}>{x.label}</option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("linkGuardian")} htmlFor="u-guardian">
          <Select id="u-guardian" name="guardianId" defaultValue={user?.guardianId ?? ""}>
            <option value="">—</option>
            {guardians.map((x) => (
              <option key={x.id} value={x.id}>{x.label}</option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField label={user ? t("resetPassword") : t("password")} htmlFor="u-password">
        <PasswordInput
          id="u-password"
          name="password"
          dir="ltr"
          autoComplete="new-password"
          placeholder={user ? t("keepPasswordHint") : t("passwordMin")}
        />
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={user?.active ?? true}
          className="size-4 accent-[var(--primary)]"
        />
        {tc("active")}
      </label>
    </>
  );
}

export function UsersManager({
  users,
  teachers,
  guardians,
  roleOptions,
}: {
  users: UserRow[];
  teachers: Opt[];
  guardians: Opt[];
  roleOptions: { key: string; label: string }[];
}) {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const locale = useLocale();
  const pg = usePagination(users);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <EntityDialog
          title={t("add")}
          action={saveUser.bind(null, locale, null)}
          fields={<UserFields teachers={teachers} guardians={guardians} roleOptions={roleOptions} />}
          trigger={
            <Button size="sm" className="gap-2">
              <Plus className="size-4" />
              {t("add")}
            </Button>
          }
        />
      </div>
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tc("name")}</TableHead>
              <TableHead>{tc("email")}</TableHead>
              <TableHead>{t("role")}</TableHead>
              <TableHead>{t("linkedTo")}</TableHead>
              <TableHead>{tc("status")}</TableHead>
              <TableHead>{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell><span dir="ltr">{u.email}</span></TableCell>
                <TableCell>
                  <Badge variant={u.role === "ADMIN" ? "default" : "muted"}>{tr(u.role as "ADMIN")}</Badge>
                </TableCell>
                <TableCell>{u.linkedLabel ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={u.active ? "success" : "muted"}>
                    {u.active ? tc("active") : tc("inactive")}
                  </Badge>
                </TableCell>
                <TableCell>
                  <EntityDialog
                    title={t("edit")}
                    action={saveUser.bind(null, locale, u.id)}
                    fields={<UserFields user={u} teachers={teachers} guardians={guardians} roleOptions={roleOptions} />}
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                        <Pencil className="size-4" />
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination {...pg} />
      </div>
    </div>
  );
}
