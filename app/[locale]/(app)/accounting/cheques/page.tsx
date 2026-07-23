import { getTranslations, setRequestLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { displayName } from "@/lib/names";
import { requireAccounting } from "@/lib/accounting/guard";
import {
  ageBuckets,
  buildForecastSeries,
  DEFAULT_FORECAST_SETTINGS,
  isOverdue,
  type ForecastCheque,
} from "@/lib/accounting/cheques";
import type { ChequeDirection, ChequeStatus } from "@/lib/enums";
import { PageHeader } from "@/components/page-header";
import { ChequesClient, type ChequeRow, type BookRow } from "./cheques-client";

export default async function ChequesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAccounting(locale);
  const t = await getTranslations("cheques");

  const [cheques, books, settingsRows] = await Promise.all([
    db.cheque.findMany({
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 1000,
      include: {
        student: { select: { name: true, nameEn: true } },
        supplier: { select: { name: true, nameEn: true } },
        book: { select: { bankName: true } },
        payment: { select: { receiptNo: true } },
      },
    }),
    db.chequeBook.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { cheques: true } } },
    }),
    db.setting.findMany({
      where: {
        key: {
          in: [
            "currency",
            "chequeConfReceived",
            "chequeConfPending",
            "chequeConfDeposited",
          ],
        },
      },
    }),
  ]);
  const settings = Object.fromEntries(settingsRows.map((s) => [s.key, s.value]));
  const forecastSettings = {
    confidenceReceived: Number(settings.chequeConfReceived) || DEFAULT_FORECAST_SETTINGS.confidenceReceived,
    confidencePending: Number(settings.chequeConfPending) || DEFAULT_FORECAST_SETTINGS.confidencePending,
    confidenceDeposited: Number(settings.chequeConfDeposited) || DEFAULT_FORECAST_SETTINGS.confidenceDeposited,
  };

  const today = new Date();
  const forecastInput: ForecastCheque[] = cheques.map((c) => ({
    status: c.status as ChequeStatus,
    direction: c.direction as ChequeDirection,
    amount: toNumber(c.amount),
    dueDate: c.dueDate,
  }));

  const rows: ChequeRow[] = cheques.map((c, i) => ({
    id: c.id,
    direction: c.direction as ChequeDirection,
    status: c.status as ChequeStatus,
    chequeNo: c.chequeNo,
    amount: toNumber(c.amount),
    bankName: c.bankName ?? c.book?.bankName ?? null,
    party:
      c.direction === "INCOMING"
        ? c.student
          ? displayName(c.student, locale)
          : c.drawerName
        : c.supplier
          ? displayName(c.supplier, locale)
          : c.payeeName,
    receiptNo: c.payment?.receiptNo ?? null,
    dueDate: c.dueDate ? c.dueDate.toISOString().slice(0, 10) : null,
    overdue: isOverdue(forecastInput[i], today),
    printable: c.direction === "OUTGOING",
  }));

  const bookRows: BookRow[] = books.map((b) => ({
    id: b.id,
    bankName: b.bankName,
    accountNo: b.accountNo,
    startNo: b.startNo,
    endNo: b.endNo,
    nextNo: b.nextNo,
    active: b.active,
    used: b._count.cheques,
    remaining: Math.max(0, b.endNo - b.nextNo + 1),
    notes: b.notes,
  }));

  return (
    <div>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ChequesClient
        cheques={rows}
        books={bookRows}
        forecast={buildForecastSeries(forecastInput, 6, forecastSettings, today)}
        aging={ageBuckets(forecastInput, today)}
        currency={settings.currency ?? "QAR"}
      />
    </div>
  );
}
