"use client";

import { useTranslations } from "next-intl";
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

export type LogRow = {
  id: string;
  at: string;
  event: string;
  audience: string;
  recipient: string;
  status: string;
  error: string | null;
};

const STATUS_VARIANT: Record<string, "success" | "destructive" | "muted"> = {
  SENT: "success",
  FAILED: "destructive",
  SKIPPED: "muted",
};

export function NotificationLogTable({ rows }: { rows: LogRow[] }) {
  const t = useTranslations("integrations");
  const tc = useTranslations("common");
  const pg = usePagination(rows);

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tc("date")}</TableHead>
            <TableHead>{t("event")}</TableHead>
            <TableHead>{t("audience")}</TableHead>
            <TableHead>{t("recipient")}</TableHead>
            <TableHead>{tc("status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                {tc("noData")}
              </TableCell>
            </TableRow>
          )}
          {pg.pageItems.map((r) => (
            <TableRow key={r.id}>
              <TableCell dir="ltr" className="text-start tabular-nums">{r.at}</TableCell>
              <TableCell className="text-xs">{r.event}</TableCell>
              <TableCell className="text-xs">{r.audience}</TableCell>
              <TableCell dir="ltr" className="text-start tabular-nums">{r.recipient || "—"}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[r.status] ?? "muted"}>{r.status}</Badge>
                {r.error && (
                  <span className="ms-2 text-xs text-muted-foreground" title={r.error}>
                    {r.error.slice(0, 40)}
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination {...pg} />
    </div>
  );
}
