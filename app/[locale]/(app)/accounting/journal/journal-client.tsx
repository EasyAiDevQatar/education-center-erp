"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { FormField } from "@/components/crud/form-field";
import { DeleteButton } from "@/components/crud/delete-button";
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
import { formatMoney } from "@/lib/money";
import { JOURNAL_SOURCES } from "@/lib/enums";
import { localNowTime, localToday } from "@/lib/session-time";
import { createManualEntry, deleteManualEntry } from "./actions";

export type EntryRow = {
  id: string;
  date: string;
  memo: string;
  sourceType: string;
  total: number;
  lines: { id: string; account: string; debit: number; credit: number; memo: string | null }[];
};
export type AccountOpt = { id: string; label: string };

type EditLine = { accountId: string; debit: string; credit: string };

const EMPTY_LINE: EditLine = { accountId: "", debit: "", credit: "" };

function ManualEntryDialog({ accounts, currency }: { accounts: AccountOpt[]; currency: string }) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => localToday());
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<EditLine[]>([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const l of lines) {
      debit += parseFloat(l.debit) || 0;
      credit += parseFloat(l.credit) || 0;
    }
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 && debit > 0 };
  }, [lines]);

  const setLine = (i: number, patch: Partial<EditLine>) =>
    setLines((ls) => ls.map((l, x) => (x === i ? { ...l, ...patch } : l)));

  function submit() {
    setError(null);
    start(async () => {
      const res = await createManualEntry(locale, {
        date,
        memo,
        lines: lines
          .filter((l) => l.accountId && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0))
          .map((l) => ({
            accountId: l.accountId,
            debit: parseFloat(l.debit) || 0,
            credit: parseFloat(l.credit) || 0,
          })),
      });
      if (res.ok) {
        setOpen(false);
        setMemo("");
        setLines([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
      } else setError(res.error ?? "invalid");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="size-4" />
          {t("addEntry")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("addEntry")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FormField label={tc("date")} htmlFor="je-date">
              <Input id="je-date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
            </FormField>
            <FormField label={t("memo")} htmlFor="je-memo">
              <Input id="je-memo" value={memo} onChange={(e) => setMemo(e.target.value)} required />
            </FormField>
          </div>

          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="flex-1">
                  <Select
                    aria-label={t("account")}
                    value={l.accountId}
                    onChange={(e) => setLine(i, { accountId: e.target.value })}
                  >
                    <option value="">{t("account")}…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.label}</option>
                    ))}
                  </Select>
                </div>
                <Input
                  aria-label={t("debit")}
                  className="w-28"
                  type="number"
                  step="0.01"
                  min="0"
                  dir="ltr"
                  placeholder={t("debit")}
                  value={l.debit}
                  onChange={(e) => setLine(i, { debit: e.target.value, credit: "" })}
                />
                <Input
                  aria-label={t("credit")}
                  className="w-28"
                  type="number"
                  step="0.01"
                  min="0"
                  dir="ltr"
                  placeholder={t("credit")}
                  value={l.credit}
                  onChange={(e) => setLine(i, { credit: e.target.value, debit: "" })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={tc("delete")}
                  disabled={lines.length <= 2}
                  onClick={() => setLines((ls) => ls.filter((_, x) => x !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => setLines((ls) => [...ls, { ...EMPTY_LINE }])}
            >
              <Plus className="size-3" />
              {t("addLine")}
            </Button>
          </div>

          {/* Live balance footer — the whole point of the dialog. */}
          <div
            className={`flex justify-between rounded-md px-3 py-2 text-sm font-medium ${
              totals.balanced
                ? "bg-[var(--success)]/10 text-[var(--success)]"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            <span>
              {t("debit")}: <span dir="ltr">{formatMoney(totals.debit)} {currency}</span>
            </span>
            <span>
              {t("credit")}: <span dir="ltr">{formatMoney(totals.credit)} {currency}</span>
            </span>
            <span>{totals.balanced ? t("balanced") : t("notBalanced")}</span>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{tc("cancel")}</Button>
          </DialogClose>
          <Button onClick={submit} disabled={pending || !totals.balanced || !memo.trim()}>
            {pending ? tc("saving") : tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function JournalClient({
  entries,
  accounts,
  currency,
}: {
  entries: EntryRow[];
  accounts: AccountOpt[];
  currency: string;
}) {
  const t = useTranslations("accounting");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const [openId, setOpenId] = useState<string | null>(null);

  const search = useTableSearch(entries, (e) => [e.memo, e.date, ...e.lines.map((l) => l.account)]);
  const columns = useMemo<ColumnDef<EntryRow>[]>(
    () => [
      { key: "date", label: tc("date"), type: "date", value: (e) => e.date },
      { key: "memo", label: t("memo"), value: (e) => e.memo },
      {
        key: "source",
        label: t("source"),
        type: "enum",
        value: (e) => e.sourceType,
        filterable: true,
        options: [...JOURNAL_SOURCES],
        optionLabel: (v) => te(`journalSource.${v}`),
      },
      { key: "total", label: tc("amount"), type: "number", value: (e) => e.total },
      { key: "actions", label: tc("actions") },
    ],
    [t, tc, te],
  );
  const sf = useTableSortFilter(search.filtered, columns, {
    defaultSort: { key: "date", dir: "desc" },
  });
  const pg = usePagination(sf.rows, 20, sf.version);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <TableSearch
          value={search.query}
          onChange={search.setQuery}
          resultCount={search.filtered.length}
          placeholder={t("journalSearchPlaceholder")}
        />
        <ManualEntryDialog accounts={accounts} currency={currency} />
      </div>
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <SortableTableHeader sf={sf} />
          </TableHeader>
          <TableBody>
            {pg.total === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  {tc("noData")}
                </TableCell>
              </TableRow>
            )}
            {pg.pageItems.map((e) => (
              <Fragment key={e.id}>
                <TableRow
                  className="cursor-pointer"
                  onClick={() => setOpenId(openId === e.id ? null : e.id)}
                >
                  <TableCell className="tabular-nums"><span dir="ltr">{e.date}</span></TableCell>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {openId === e.id ? (
                        <ChevronUp className="size-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="size-3.5 text-muted-foreground" />
                      )}
                      {e.memo}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={e.sourceType === "MANUAL" ? "warning" : "default"}>
                      {te(`journalSource.${e.sourceType as "MANUAL"}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <span dir="ltr">
                      {formatMoney(e.total)} {currency}
                    </span>
                  </TableCell>
                  <TableCell onClick={(ev) => ev.stopPropagation()}>
                    {e.sourceType === "MANUAL" && (
                      <DeleteButton action={deleteManualEntry.bind(null, locale, e.id)} />
                    )}
                  </TableCell>
                </TableRow>
                {openId === e.id && (
                  <TableRow>
                    <TableCell colSpan={5} className="bg-muted/30 p-0">
                      <table className="w-full text-sm">
                        <tbody>
                          {e.lines.map((l) => (
                            <tr key={l.id} className="border-b border-border/40 last:border-0">
                              <td className="px-6 py-1.5">{l.account}</td>
                              <td className="w-32 px-2 py-1.5 tabular-nums">
                                <span dir="ltr">
                                  {l.debit > 0 ? formatMoney(l.debit) : ""}
                                </span>
                              </td>
                              <td className="w-32 px-2 py-1.5 tabular-nums">
                                <span dir="ltr">
                                  {l.credit > 0 ? formatMoney(l.credit) : ""}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
        <TablePagination {...pg} />
      </div>
    </>
  );
}
