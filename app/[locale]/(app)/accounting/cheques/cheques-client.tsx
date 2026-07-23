"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Printer, TrendingUp } from "lucide-react";
import { EntityDialog } from "@/components/crud/entity-dialog";
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
import { Link, useRouter } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import {
  CHEQUE_STATUSES,
  type ChequeDirection,
  type ChequeStatus,
} from "@/lib/enums";
import { CHEQUE_TRANSITIONS, type AgeBuckets, type ForecastPoint } from "@/lib/accounting/cheques";
import { createOutgoingCheque, saveChequeBook, transitionCheque } from "./actions";

export type ChequeRow = {
  id: string;
  direction: ChequeDirection;
  status: ChequeStatus;
  chequeNo: string;
  amount: number;
  bankName: string | null;
  party: string | null;
  receiptNo: string | null;
  dueDate: string | null;
  overdue: boolean;
  printable: boolean;
};
export type BookRow = {
  id: string;
  bankName: string;
  accountNo: string | null;
  startNo: number;
  endNo: number;
  nextNo: number;
  active: boolean;
  used: number;
  remaining: number;
  notes?: string | null;
};

const STATUS_BADGE: Record<string, "muted" | "default" | "warning" | "success" | "destructive"> = {
  DRAFT: "muted",
  RECEIVED: "default",
  PENDING_DEPOSIT: "warning",
  DEPOSITED: "warning",
  CLEARED: "success",
  BOUNCED: "destructive",
  REPLACED: "muted",
  CANCELLED: "muted",
  VOID: "muted",
};

function TransitionButtons({ cheque }: { cheque: ChequeRow }) {
  const t = useTranslations("cheques");
  const te = useTranslations("enums");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [bounceOpen, setBounceOpen] = useState(false);
  const [bounceReason, setBounceReason] = useState("");
  const [bounceFee, setBounceFee] = useState("0");

  const targets = CHEQUE_TRANSITIONS[cheque.direction][cheque.status] ?? [];
  if (targets.length === 0) return null;

  const go = (toStatus: ChequeStatus, note?: string, fee?: number) =>
    start(async () => {
      await transitionCheque(locale, {
        chequeId: cheque.id,
        toStatus,
        note: note ?? null,
        bounceFee: fee ?? 0,
      });
      setBounceOpen(false);
      router.refresh();
    });

  return (
    <span className="inline-flex flex-wrap justify-end gap-1">
      {targets
        .filter((s) => s !== "REPLACED") // replacement = record the new cheque manually
        .map((s) =>
          s === "BOUNCED" ? (
            <Button
              key={s}
              variant="outline"
              size="sm"
              className="h-7 text-destructive"
              disabled={pending}
              onClick={() => setBounceOpen(true)}
            >
              {te(`chequeStatus.${s}`)}
            </Button>
          ) : (
            <Button
              key={s}
              variant="outline"
              size="sm"
              className="h-7"
              disabled={pending}
              onClick={() => go(s)}
            >
              {te(`chequeStatus.${s}`)}
            </Button>
          ),
        )}
      {bounceOpen && (
        <span className="flex items-center gap-1">
          <Input
            className="h-7 w-28"
            placeholder={t("bounceReason")}
            value={bounceReason}
            onChange={(e) => setBounceReason(e.target.value)}
          />
          <Input
            className="h-7 w-20"
            type="number"
            min="0"
            dir="ltr"
            placeholder={t("bounceFee")}
            value={bounceFee}
            onChange={(e) => setBounceFee(e.target.value)}
          />
          <Button
            variant="destructive"
            size="sm"
            className="h-7"
            disabled={pending}
            onClick={() => go("BOUNCED", bounceReason, parseFloat(bounceFee) || 0)}
          >
            {t("confirmBounce")}
          </Button>
        </span>
      )}
    </span>
  );
}

function OutgoingFields({ books }: { books: BookRow[] }) {
  const t = useTranslations("cheques");
  const tc = useTranslations("common");
  const usable = books.filter((b) => b.active && b.remaining > 0);
  return (
    <>
      <FormField label={t("book")} htmlFor="bookId" hint={t("bookHint")}>
        <Select id="bookId" name="bookId" required defaultValue={usable[0]?.id ?? ""}>
          {usable.map((b) => (
            <option key={b.id} value={b.id}>
              {b.bankName} — {t("nextLeaf")} {b.nextNo}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("payee")} htmlFor="payeeName">
          <Input id="payeeName" name="payeeName" required />
        </FormField>
        <FormField label={tc("amount")} htmlFor="amount">
          <Input id="amount" name="amount" type="number" step="0.01" min="0" dir="ltr" required />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("dueDate")} htmlFor="dueDate">
          <Input id="dueDate" name="dueDate" type="date" dir="ltr" />
        </FormField>
        <FormField label={tc("notes")} htmlFor="notes">
          <Input id="notes" name="notes" />
        </FormField>
      </div>
    </>
  );
}

function BookFields({ book }: { book?: BookRow }) {
  const t = useTranslations("cheques");
  const tc = useTranslations("common");
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("bankName")} htmlFor="bankName">
          <Input id="bankName" name="bankName" defaultValue={book?.bankName} required />
        </FormField>
        <FormField label={t("accountNo")} htmlFor="accountNo">
          <Input id="accountNo" name="accountNo" dir="ltr" defaultValue={book?.accountNo ?? ""} />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("startNo")} htmlFor="startNo">
          <Input
            id="startNo"
            name="startNo"
            type="number"
            min="1"
            dir="ltr"
            defaultValue={book?.startNo ?? ""}
            required
            disabled={!!book}
          />
        </FormField>
        <FormField label={t("endNo")} htmlFor="endNo">
          <Input id="endNo" name="endNo" type="number" min="1" dir="ltr" defaultValue={book?.endNo ?? ""} required />
        </FormField>
      </div>
      {book && <input type="hidden" name="startNo" value={book.startNo} />}
      <FormField label={tc("notes")} htmlFor="notes">
        <Input id="notes" name="notes" defaultValue={book?.notes ?? undefined} />
      </FormField>
    </>
  );
}

export function ChequesClient({
  cheques,
  books,
  forecast,
  aging,
  currency,
}: {
  cheques: ChequeRow[];
  books: BookRow[];
  forecast: ForecastPoint[];
  aging: AgeBuckets;
  currency: string;
}) {
  const t = useTranslations("cheques");
  const tc = useTranslations("common");
  const te = useTranslations("enums");
  const locale = useLocale();
  const [tab, setTab] = useState<"register" | "books">("register");

  const search = useTableSearch(cheques, (c) => [c.chequeNo, c.party, c.bankName, c.receiptNo]);
  const columns = useMemo<ColumnDef<ChequeRow>[]>(
    () => [
      { key: "no", label: t("chequeNo"), value: (c) => c.chequeNo },
      {
        key: "direction",
        label: t("direction"),
        type: "enum",
        value: (c) => c.direction,
        filterable: true,
        options: ["INCOMING", "OUTGOING"],
        optionLabel: (v) => te(`chequeDirection.${v}`),
      },
      { key: "party", label: t("party"), value: (c) => c.party },
      { key: "amount", label: tc("amount"), type: "number", value: (c) => c.amount, className: "text-end" },
      { key: "due", label: t("dueDate"), type: "date", value: (c) => c.dueDate },
      {
        key: "status",
        label: tc("status"),
        type: "enum",
        value: (c) => c.status,
        filterable: true,
        options: [...CHEQUE_STATUSES],
        optionLabel: (v) => te(`chequeStatus.${v}`),
      },
      { key: "actions", label: tc("actions"), className: "text-end" },
    ],
    [t, tc, te],
  );
  const sf = useTableSortFilter(search.filtered, columns);
  const pg = usePagination(sf.rows, 20, sf.version);

  const maxAbs = Math.max(1, ...forecast.map((p) => Math.abs(p.gross)));

  return (
    <div className="space-y-4">
      {/* Forecast + aging */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <TrendingUp className="size-4 text-primary" />
            {t("forecastTitle")}
          </div>
          <div className="flex items-end gap-2" style={{ height: 96 }}>
            {forecast.map((p) => (
              <div key={p.label} className="flex flex-1 flex-col items-center gap-1" title={`${p.label}: ${formatMoney(p.weighted)} / ${formatMoney(p.gross)}`}>
                <div className="flex w-full flex-1 items-end justify-center gap-0.5">
                  <div
                    className="w-2 rounded-t bg-primary/30"
                    style={{ height: `${(Math.abs(p.gross) / maxAbs) * 80}%` }}
                  />
                  <div
                    className={`w-2 rounded-t ${p.weighted >= 0 ? "bg-primary" : "bg-destructive"}`}
                    style={{ height: `${(Math.abs(p.weighted) / maxAbs) * 80}%` }}
                  />
                </div>
                <span className="text-[10px] tabular-nums text-muted-foreground" dir="ltr">
                  {p.label.slice(5)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t("forecastHint")}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mb-2 font-semibold">{t("agingTitle")}</p>
          <div className="grid grid-cols-5 gap-2 text-center text-sm">
            {(
              [
                ["current", aging.current],
                ["d7", aging.d7],
                ["d30", aging.d30],
                ["d60", aging.d60],
                ["d60Plus", aging.d60Plus],
              ] as const
            ).map(([key, val]) => (
              <div key={key} className="rounded-md bg-muted/40 p-2">
                <p className="text-xs text-muted-foreground">{t(`aging.${key}`)}</p>
                <p className="font-semibold tabular-nums" dir="ltr">{formatMoney(val)}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("agingHint")}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
          {(["register", "books"] as const).map((x) => (
            <button
              key={x}
              onClick={() => setTab(x)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === x ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {t(`tabs.${x}`)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <EntityDialog
            title={t("addBook")}
            action={saveChequeBook.bind(null, locale, null)}
            fields={<BookFields />}
            trigger={<Button variant="outline" className="gap-2"><Plus className="size-4" />{t("addBook")}</Button>}
          />
          <EntityDialog
            title={t("addOutgoing")}
            action={createOutgoingCheque.bind(null, locale)}
            fields={<OutgoingFields books={books} />}
            trigger={<Button className="gap-2"><Plus className="size-4" />{t("addOutgoing")}</Button>}
          />
        </div>
      </div>

      {tab === "register" && (
        <>
          <TableSearch
            value={search.query}
            onChange={search.setQuery}
            resultCount={search.filtered.length}
            placeholder={t("searchPlaceholder")}
          />
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
                {pg.pageItems.map((c) => (
                  <TableRow key={c.id} className={c.overdue ? "bg-destructive/5" : undefined}>
                    <TableCell className="font-mono" dir="ltr">{c.chequeNo}</TableCell>
                    <TableCell>
                      <Badge variant={c.direction === "INCOMING" ? "success" : "warning"}>
                        {te(`chequeDirection.${c.direction}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {c.party ?? "—"}
                      {c.receiptNo && (
                        <span className="ms-1 text-xs text-muted-foreground" dir="ltr">#{c.receiptNo}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {formatMoney(c.amount)} {currency}
                    </TableCell>
                    <TableCell className="tabular-nums" dir="ltr">
                      {c.dueDate ?? "—"}
                      {c.overdue && <Badge variant="destructive" className="ms-1">{t("overdue")}</Badge>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[c.status]}>{te(`chequeStatus.${c.status}`)}</Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      <span className="inline-flex items-center gap-1">
                        {c.printable && (
                          <Link href={`/statement/cheque/${c.id}`}>
                            <Button variant="ghost" size="icon" aria-label={tc("print")}>
                              <Printer className="size-4" />
                            </Button>
                          </Link>
                        )}
                        <TransitionButtons cheque={c} />
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination {...pg} />
          </div>
        </>
      )}

      {tab === "books" && (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableCell className="font-medium">{t("bankName")}</TableCell>
                <TableCell className="font-medium">{t("accountNo")}</TableCell>
                <TableCell className="font-medium text-end">{t("range")}</TableCell>
                <TableCell className="font-medium text-end">{t("nextLeaf")}</TableCell>
                <TableCell className="font-medium text-end">{t("remaining")}</TableCell>
                <TableCell className="font-medium text-end">{tc("actions")}</TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {books.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    {tc("noData")}
                  </TableCell>
                </TableRow>
              )}
              {books.map((b) => (
                <TableRow key={b.id} className={b.active ? undefined : "opacity-60"}>
                  <TableCell className="font-medium">{b.bankName}</TableCell>
                  <TableCell dir="ltr">{b.accountNo ?? "—"}</TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {b.startNo} – {b.endNo}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">{b.nextNo}</TableCell>
                  <TableCell className="text-end">
                    <Badge variant={b.remaining > 5 ? "success" : b.remaining > 0 ? "warning" : "destructive"}>
                      {b.remaining}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    <EntityDialog
                      title={t("editBook")}
                      action={saveChequeBook.bind(null, locale, b.id)}
                      fields={<BookFields book={b} />}
                      trigger={<Button variant="ghost" size="sm">{tc("edit")}</Button>}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
