"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Pencil, Lock } from "lucide-react";
import { EntityDialog } from "@/components/crud/entity-dialog";
import { DeleteButton } from "@/components/crud/delete-button";
import { FormField } from "@/components/crud/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SortableTableHeader,
  useTableSortFilter,
  type ColumnDef,
} from "@/components/ui/table-sort";
import { usePagination, TablePagination } from "@/components/ui/table-pagination";
import { TableSearch, useTableSearch } from "@/components/ui/table-search";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/enums";
import { saveAccount, deleteAccount } from "./actions";

export type AccountRow = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  parentLabel: string | null;
  system: boolean;
  active: boolean;
  notes: string | null;
  lineCount: number;
};

const TYPE_BADGE: Record<AccountType, "default" | "success" | "warning" | "muted" | "destructive"> = {
  ASSET: "success",
  LIABILITY: "warning",
  EQUITY: "muted",
  INCOME: "default",
  EXPENSE: "destructive",
};

function AccountFields({
  account,
  accounts,
}: {
  account?: AccountRow;
  accounts: AccountRow[];
}) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const [type, setType] = useState<AccountType>(account?.type ?? "EXPENSE");

  // Same-type parents only; the action enforces it, the form just avoids
  // offering an invalid choice.
  const parents = accounts.filter((a) => a.type === type && a.id !== account?.id);

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("code")} htmlFor="code" hint={t("codeHint")}>
          <Input
            id="code"
            name="code"
            dir="ltr"
            defaultValue={account?.code ?? ""}
            required
            disabled={account?.system}
          />
        </FormField>
        <FormField label={t("type")} htmlFor="type">
          <Select
            id="type"
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as AccountType)}
            disabled={account?.system}
          >
            {ACCOUNT_TYPES.map((x) => (
              <option key={x} value={x}>{te(`accountType.${x}`)}</option>
            ))}
          </Select>
        </FormField>
      </div>
      {/* A disabled control posts nothing; keep the values in the form data. */}
      {account?.system && (
        <>
          <input type="hidden" name="code" value={account.code} />
          <input type="hidden" name="type" value={account.type} />
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormField label={tc("nameAr")} htmlFor="nameAr">
          <Input id="nameAr" name="nameAr" defaultValue={account?.nameAr ?? ""} required />
        </FormField>
        <FormField label={tc("nameEn")} htmlFor="nameEn">
          <Input id="nameEn" name="nameEn" dir="ltr" defaultValue={account?.nameEn ?? ""} required />
        </FormField>
      </div>
      <FormField label={t("parent")} htmlFor="parentId" hint={t("parentHint")}>
        <Select id="parentId" name="parentId" defaultValue={account?.parentId ?? ""}>
          <option value="">—</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
          ))}
        </Select>
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={account?.active ?? true}
          className="size-4 accent-primary"
        />
        {tc("active")}
      </label>
      <FormField label={tc("notes")} htmlFor="notes">
        <Input id="notes" name="notes" defaultValue={account?.notes ?? ""} />
      </FormField>
    </>
  );
}

export function AccountsClient({ accounts }: { accounts: AccountRow[] }) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();

  const search = useTableSearch(accounts, (a) => [a.code, a.nameAr, a.nameEn]);
  const columns = useMemo<ColumnDef<AccountRow>[]>(
    () => [
      { key: "code", label: t("code"), value: (a) => a.code },
      { key: "name", label: tc("name"), value: (a) => a.name },
      {
        key: "type",
        label: t("type"),
        type: "enum",
        value: (a) => a.type,
        filterable: true,
        options: [...ACCOUNT_TYPES],
        optionLabel: (v) => te(`accountType.${v}`),
      },
      { key: "parent", label: t("parent"), value: (a) => a.parentLabel },
      { key: "entries", label: t("entriesCount"), type: "number", value: (a) => a.lineCount },
      {
        key: "status",
        label: tc("status"),
        type: "enum",
        value: (a) => (a.active ? "active" : "inactive"),
        filterable: true,
        options: ["active", "inactive"],
        optionLabel: (v) => tc(v as "active"),
      },
      { key: "actions", label: tc("actions") },
    ],
    [t, tc, te],
  );
  const sf = useTableSortFilter(search.filtered, columns);
  const pg = usePagination(sf.rows, 50, sf.version);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <TableSearch
          value={search.query}
          onChange={search.setQuery}
          resultCount={search.filtered.length}
          placeholder={t("searchPlaceholder")}
        />
        <EntityDialog
          title={t("addAccount")}
          action={saveAccount.bind(null, locale, null)}
          fields={<AccountFields accounts={accounts} />}
          trigger={
            <Button className="gap-2">
              <Plus className="size-4" />
              {t("addAccount")}
            </Button>
          }
        />
      </div>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <SortableTableHeader sf={sf} />
          </TableHeader>
          <TableBody>
            {pg.total === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((a) => (
              <TableRow key={a.id} className={a.active ? undefined : "opacity-60"}>
                <TableCell className="font-mono"><span dir="ltr">{a.code}</span></TableCell>
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {a.system && <Lock className="size-3 text-muted-foreground" />}
                    {a.name}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={TYPE_BADGE[a.type]}>{te(`accountType.${a.type}`)}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{a.parentLabel ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{a.lineCount}</TableCell>
                <TableCell>
                  {a.active ? (
                    <Badge variant="success">{tc("active")}</Badge>
                  ) : (
                    <Badge variant="muted">{tc("inactive")}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex justify-center gap-1">
                    <EntityDialog
                      title={t("editAccount")}
                      action={saveAccount.bind(null, locale, a.id)}
                      fields={<AccountFields account={a} accounts={accounts} />}
                      trigger={
                        <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                          <Pencil className="size-4" />
                        </Button>
                      }
                    />
                    {/* System accounts and accounts with history can only be
                        deactivated — the action refuses, so no button. */}
                    {!a.system && a.lineCount === 0 && (
                      <DeleteButton action={deleteAccount.bind(null, locale, a.id)} />
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination {...pg} />
      </div>
    </>
  );
}
