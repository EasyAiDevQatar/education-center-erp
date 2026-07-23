import "server-only";
import { db } from "@/lib/db";
import { toNumber } from "@/lib/money";
import { DEFAULT_ACCOUNTS } from "./coa";
import {
  isBalanced,
  linesForExpense,
  linesForPayment,
  linesForPayslip,
  type DraftEntry,
} from "./posting";

/**
 * The module's on switch. Read per request — never cached at module level, so
 * flipping the setting takes effect immediately.
 */
export async function accountingEnabled(): Promise<boolean> {
  const row = await db.setting.findUnique({ where: { key: "accountingEnabled" } });
  return row?.value === "1";
}

/**
 * Seed/repair the default chart of accounts. Upsert by code and never touch
 * the names of an existing row — the accountant may have renamed accounts,
 * and re-enabling the module must not undo that.
 */
export async function ensureChartOfAccounts(): Promise<void> {
  const byCode = new Map<string, string>();
  for (const a of DEFAULT_ACCOUNTS) {
    const row = await db.account.upsert({
      where: { code: a.code },
      update: { system: true },
      create: {
        code: a.code,
        nameAr: a.nameAr,
        nameEn: a.nameEn,
        type: a.type,
        system: true,
      },
    });
    byCode.set(a.code, row.id);
  }
  // Parents in a second pass so order in DEFAULT_ACCOUNTS never matters.
  for (const a of DEFAULT_ACCOUNTS) {
    if (!a.parentCode) continue;
    const parentId = byCode.get(a.parentCode);
    if (parentId) {
      await db.account.update({ where: { code: a.code }, data: { parentId } });
    }
  }
}

/** Prisma transaction client — structural, so both db and $transaction work. */
type Tx = Pick<typeof db, "journalEntry" | "account">;

async function accountIdsFor(tx: Tx, draft: DraftEntry): Promise<Map<string, string> | null> {
  const codes = [...new Set(draft.lines.map((l) => l.accountCode))];
  const accounts = await tx.account.findMany({ where: { code: { in: codes } } });
  if (accounts.length !== codes.length) return null;
  return new Map(accounts.map((a) => [a.code, a.id]));
}

/**
 * Write one journal entry. Idempotent on `[sourceType, sourceId]`: a re-run
 * (double click, replayed action) is silently skipped, the same convention the
 * payroll unique follows. Refuses unbalanced drafts outright — the builders
 * are tested, but this is the last line between a bug and crooked books.
 */
export async function postSource(tx: Tx, draft: DraftEntry): Promise<void> {
  if (!isBalanced(draft.lines)) {
    throw new Error(`unbalanced journal draft: ${draft.sourceType}/${draft.sourceId}`);
  }
  const ids = await accountIdsFor(tx, draft);
  if (!ids) throw new Error("journal draft references unknown account code");
  try {
    await tx.journalEntry.create({
      data: {
        date: draft.date,
        memo: draft.memo,
        sourceType: draft.sourceType,
        sourceId: draft.sourceId,
        lines: {
          create: draft.lines.map((l) => ({
            accountId: ids.get(l.accountCode)!,
            debit: l.debit,
            credit: l.credit,
            memo: l.memo ?? null,
          })),
        },
      },
    });
  } catch (err) {
    // P2002 on [sourceType, sourceId] = already posted. Skip, by design.
    if ((err as { code?: string }).code !== "P2002") throw err;
  }
}

/** Replace the entry for an edited source document (delete + recreate, one tx). */
export async function repostSource(tx: Tx, draft: DraftEntry): Promise<void> {
  if (draft.sourceId == null) throw new Error("repost needs a sourceId");
  await tx.journalEntry.deleteMany({
    where: { sourceType: draft.sourceType, sourceId: draft.sourceId },
  });
  await postSource(tx, draft);
}

/** Remove the entry for a deleted source document. Missing = already clean. */
export async function unpostSource(
  tx: Tx,
  sourceType: string,
  sourceId: string,
): Promise<void> {
  await tx.journalEntry.deleteMany({ where: { sourceType, sourceId } });
}

/**
 * Post every historical payment, expense and PAID payslip from `fromDate`
 * onwards. Safe to run repeatedly — the `[sourceType, sourceId]` unique turns
 * already-posted documents into skips — which also makes it the repair tool
 * for gaps created while the module was switched off.
 */
export async function backfillJournal(fromDate: Date): Promise<Record<string, number>> {
  await ensureChartOfAccounts();
  const summary = { payments: 0, expenses: 0, payslips: 0 };

  const before = await db.journalEntry.count();

  const payments = await db.payment.findMany({ where: { date: { gte: fromDate } } });
  for (const p of payments) {
    await postSource(db, {
      date: p.date,
      memo: `دفعة — إيصال ${p.receiptNo}`,
      sourceType: "PAYMENT",
      sourceId: p.id,
      lines: linesForPayment({
        amount: toNumber(p.amount),
        method: p.method,
        receiptNo: p.receiptNo,
      }),
    });
    summary.payments++;
  }

  const expenses = await db.expense.findMany({
    where: { date: { gte: fromDate } },
    include: { category: { include: { account: { select: { code: true } } } } },
  });
  for (const e of expenses) {
    await postSource(db, {
      date: e.date,
      memo: `مصروف — ${e.description}`,
      sourceType: "EXPENSE",
      sourceId: e.id,
      lines: linesForExpense({
        amount: toNumber(e.amount),
        categoryAccountCode: e.category?.account?.code ?? null,
      }),
    });
    summary.expenses++;
  }

  const payouts = await db.teacherPayout.findMany({
    where: { status: "PAID", periodEnd: { gte: fromDate } },
    include: { teacher: { select: { name: true } }, employee: { select: { name: true } } },
  });
  for (const p of payouts) {
    await postSource(db, {
      date: p.paidAt ?? p.periodEnd,
      memo: `راتب — ${p.teacher?.name ?? p.employee?.name ?? p.id}`,
      sourceType: "PAYROLL",
      sourceId: p.id,
      lines: linesForPayslip({ net: toNumber(p.netPaid), method: p.paymentMethod }),
    });
    summary.payslips++;
  }

  const after = await db.journalEntry.count();
  return { ...summary, created: after - before };
}
