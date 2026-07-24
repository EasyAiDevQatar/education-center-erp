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
import { formatMoney } from "@/lib/money";

export type LedgerEntry = {
  date: string;
  type: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
};

export function LedgerTable({ ledger }: { ledger: LedgerEntry[] }) {
  const t = useTranslations("students");
  const tc = useTranslations("common");
  const pg = usePagination(ledger);

  return (
    <div className="rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{tc("date")}</TableHead>
            <TableHead>{tc("actions")}</TableHead>
            <TableHead>{t("totalCharges")}</TableHead>
            <TableHead>{t("totalPaid")}</TableHead>
            <TableHead>{t("balance")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ledger.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                {tc("noData")}
              </TableCell>
            </TableRow>
          )}
          {pg.pageItems.map((e, i) => (
            <TableRow key={pg.start + i}>
              <TableCell className="tabular-nums"><span dir="ltr">{e.date}</span></TableCell>
              <TableCell>
                <Badge variant={e.type === "PAYMENT" ? "success" : "muted"}>
                  {e.description}
                </Badge>
              </TableCell>
              <TableCell className="tabular-nums">
                {e.debit ? formatMoney(e.debit) : "—"}
              </TableCell>
              <TableCell className="tabular-nums text-[var(--success)]">
                {e.credit ? formatMoney(e.credit) : "—"}
              </TableCell>
              <TableCell className="tabular-nums font-medium">
                {formatMoney(e.balance)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination {...pg} />
    </div>
  );
}
