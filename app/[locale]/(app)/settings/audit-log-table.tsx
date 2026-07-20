"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePagination, TablePagination } from "@/components/ui/table-pagination";

export type AuditRow = {
  id: string;
  at: string;
  userName: string | null;
  entity: string;
  entityId: string;
  action: string;
};

const ACTION_VARIANT: Record<string, "success" | "warning" | "destructive" | "muted"> = {
  CREATE: "success",
  UPDATE: "warning",
  DELETE: "destructive",
};

export function AuditLogTable({ rows }: { rows: AuditRow[] }) {
  const t = useTranslations("audit");
  const tc = useTranslations("common");

  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!entity || r.entity.toLowerCase().includes(entity.toLowerCase())) &&
          (!action || r.action === action),
      ),
    [rows, entity, action],
  );
  const pg = usePagination(filtered);

  return (
    <div>
      <div className="flex flex-wrap gap-2 border-b border-border p-3">
        <Input
          placeholder={t("filterEntity")}
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          className="h-9 w-48"
        />
        <Select value={action} onChange={(e) => setAction(e.target.value)} className="h-9 w-36">
          <option value="">{tc("all")}</option>
          <option value="CREATE">{t("actions.CREATE")}</option>
          <option value="UPDATE">{t("actions.UPDATE")}</option>
          <option value="DELETE">{t("actions.DELETE")}</option>
        </Select>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tc("date")}</TableHead>
            <TableHead>{t("user")}</TableHead>
            <TableHead>{t("entity")}</TableHead>
            <TableHead>{t("record")}</TableHead>
            <TableHead>{t("action")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                {tc("noData")}
              </TableCell>
            </TableRow>
          )}
          {pg.pageItems.map((r) => (
            <TableRow key={r.id}>
              <TableCell dir="ltr" className="text-start tabular-nums">{r.at}</TableCell>
              <TableCell>{r.userName ?? "—"}</TableCell>
              <TableCell>{r.entity}</TableCell>
              <TableCell dir="ltr" className="max-w-40 truncate text-start text-xs text-muted-foreground">
                {r.entityId}
              </TableCell>
              <TableCell>
                <Badge variant={ACTION_VARIANT[r.action] ?? "muted"}>
                  {t(`actions.${r.action}` as "actions.CREATE")}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination {...pg} />
    </div>
  );
}
